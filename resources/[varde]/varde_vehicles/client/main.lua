local vehicles = {}
local rawConfig = LoadResourceFile(GetCurrentResourceName(), 'config/vehicles.json')
local config = rawConfig and json.decode(rawConfig) or { garages = {} }

local function nativeTrue(value)
    return value == true or value == 1
end

local function copy(value)
    if value == nil then
        return nil
    end
    return json.decode(json.encode(value))
end

local function message(text, kind)
    local color = kind == 'error' and { 220, 70, 70 } or { 90, 180, 255 }
    TriggerEvent('chat:addMessage', {
        color = color,
        args = { 'Varde', tostring(text) }
    })
    print(('[varde_vehicles] %s'):format(tostring(text)))
end

local function distance(left, right)
    local dx = left.x - right.x
    local dy = left.y - right.y
    local dz = left.z - right.z
    return math.sqrt(dx * dx + dy * dy + dz * dz)
end

local function nearestGarage(pointName, maximumDistance)
    local coords = GetEntityCoords(PlayerPedId())
    local nearestId = nil
    local nearestDistance = maximumDistance or 10.0
    for garageId, garage in pairs(config.garages or {}) do
        local point = garage[pointName]
        if point then
            local current = distance(coords, point)
            if current < nearestDistance then
                nearestId = garageId
                nearestDistance = current
            end
        end
    end
    return nearestId, nearestDistance
end

local function closestVehicle()
    local ped = PlayerPedId()
    local current = GetVehiclePedIsIn(ped, false)
    if current and current ~= 0 then
        return current
    end
    local coords = GetEntityCoords(ped)
    local vehicle = GetClosestVehicle(
        coords.x,
        coords.y,
        coords.z,
        7.0,
        0,
        70
    )
    if vehicle and vehicle ~= 0 and DoesEntityExist(vehicle) then
        return vehicle
    end
    return 0
end

local function networkId(vehicle)
    if vehicle == 0 or not DoesEntityExist(vehicle) then
        return nil
    end
    local id = NetworkGetNetworkIdFromEntity(vehicle)
    if not id or id == 0 then
        return nil
    end
    return id
end

local function captureRuntimeProperties(vehicle)
    return {
        engineHealth = GetVehicleEngineHealth(vehicle),
        bodyHealth = GetVehicleBodyHealth(vehicle),
        tankHealth = GetVehiclePetrolTankHealth(vehicle),
        fuelLevel = GetVehicleFuelLevel(vehicle),
        dirtLevel = GetVehicleDirtLevel(vehicle)
    }
end

local function applyProperties(vehicle, properties)
    if type(properties) ~= 'table' then
        return
    end
    if properties.primaryColor ~= nil and properties.secondaryColor ~= nil then
        SetVehicleColours(
            vehicle,
            tonumber(properties.primaryColor),
            tonumber(properties.secondaryColor)
        )
    end
    if properties.pearlescentColor ~= nil and properties.wheelColor ~= nil then
        SetVehicleExtraColours(
            vehicle,
            tonumber(properties.pearlescentColor),
            tonumber(properties.wheelColor)
        )
    end
    if type(properties.mods) == 'table' then
        SetVehicleModKit(vehicle, 0)
        for modType, modIndex in pairs(properties.mods) do
            SetVehicleMod(
                vehicle,
                tonumber(modType),
                tonumber(modIndex),
                false
            )
        end
    end
    if properties.engineHealth ~= nil then
        SetVehicleEngineHealth(vehicle, tonumber(properties.engineHealth))
    end
    if properties.bodyHealth ~= nil then
        SetVehicleBodyHealth(vehicle, tonumber(properties.bodyHealth))
    end
    if properties.tankHealth ~= nil then
        SetVehiclePetrolTankHealth(vehicle, tonumber(properties.tankHealth))
    end
    if properties.fuelLevel ~= nil then
        SetVehicleFuelLevel(vehicle, tonumber(properties.fuelLevel))
    end
    if properties.dirtLevel ~= nil then
        SetVehicleDirtLevel(vehicle, tonumber(properties.dirtLevel))
    end
end

local function printGarage()
    if #vehicles == 0 then
        message('You do not have any vehicle keys.')
        return
    end
    message('Vehicles - use /garage spawn <vehicle id> at a garage:')
    for _, vehicle in ipairs(vehicles) do
        message(('%s | %s | %s | %s'):format(
            vehicle.id,
            vehicle.model,
            vehicle.plate,
            vehicle.state
        ))
    end
end

RegisterNetEvent('varde_vehicles:client:update', function(snapshot)
    vehicles = snapshot and snapshot.vehicles or {}
    TriggerEvent('varde_vehicles:client:updated', copy(snapshot))
end)

RegisterNetEvent('varde_vehicles:client:message', function(text, kind)
    message(text, kind)
end)

RegisterNetEvent('varde_vehicles:client:spawned', function(id, vehicle)
    CreateThread(function()
        local deadline = GetGameTimer() + 10000
        while GetGameTimer() < deadline
            and not nativeTrue(NetworkDoesEntityExistWithNetworkId(id)) do
            Wait(50)
        end
        local entity = NetToVeh(id)
        if entity == 0 or not DoesEntityExist(entity) then
            message('Vehicle was created, but did not stream in.', 'error')
            return
        end
        SetVehicleNumberPlateText(entity, vehicle.plate)
        SetVehicleDoorsLocked(entity, vehicle.locked and 2 or 1)
        applyProperties(entity, vehicle.properties)
        local ped = PlayerPedId()
        if IsVehicleSeatFree(entity, -1) then
            SetPedIntoVehicle(ped, entity, -1)
        end
    end)
end)

AddStateBagChangeHandler('varde:initVehicle', nil, function(bagName, key, value)
    if type(value) ~= 'table' then
        return
    end
    CreateThread(function()
        local deadline = GetGameTimer() + 15000
        while GetGameTimer() < deadline do
            local current = GetStateBagValue(bagName, key)
            if not current then
                return
            end
            local entity = GetEntityFromStateBagName(bagName)
            if entity ~= 0 and DoesEntityExist(entity)
                and NetworkGetEntityOwner(entity) == PlayerId() then
                SetVehicleNumberPlateText(entity, tostring(current.plate or ''))
                SetVehicleDoorsLocked(entity, current.locked and 2 or 1)
                applyProperties(entity, current.properties)
                SetVehicleOnGroundProperly(entity)
                TriggerServerEvent(
                    'varde_vehicles:server:initialized',
                    NetworkGetNetworkIdFromEntity(entity)
                )
                return
            end
            Wait(0)
        end
    end)
end)

RegisterNetEvent('varde_vehicles:client:lockChanged', function(id, locked)
    if not nativeTrue(NetworkDoesEntityExistWithNetworkId(id)) then
        return
    end
    local vehicle = NetToVeh(id)
    if vehicle == 0 then
        return
    end
    SetVehicleDoorsLocked(vehicle, locked and 2 or 1)
    SetVehicleLights(vehicle, 2)
    CreateThread(function()
        Wait(120)
        if DoesEntityExist(vehicle) then
            SetVehicleLights(vehicle, 0)
        end
    end)
end)

RegisterNetEvent('varde:client:playerLoaded', function()
    TriggerServerEvent('varde_vehicles:server:request')
end)

RegisterNetEvent('varde:client:playerLoggedOut', function()
    vehicles = {}
end)

RegisterCommand('garage', function(_, args)
    local action = args[1] and string.lower(args[1]) or nil
    if not action then
        printGarage()
        return
    end
    if action == 'spawn' then
        if not args[2] then
            message('Usage: /garage spawn <vehicle id>', 'error')
            return
        end
        local garageId = nearestGarage('menu', 6.0)
        if not garageId then
            message('You must be at a garage menu.', 'error')
            return
        end
        TriggerServerEvent('varde_vehicles:server:spawn', args[2], garageId)
        return
    end
    if action == 'store' then
        local garageId = nearestGarage('store', 8.0)
        local vehicle = GetVehiclePedIsIn(PlayerPedId(), false)
        local id = networkId(vehicle)
        if not garageId or not id then
            message('Drive your vehicle to a garage store marker.', 'error')
            return
        end
        TriggerServerEvent(
            'varde_vehicles:server:store',
            id,
            garageId,
            captureRuntimeProperties(vehicle)
        )
        return
    end
    message('Usage: /garage [spawn <vehicle id>|store]', 'error')
end, false)

RegisterCommand('trunk', function()
    local id = networkId(closestVehicle())
    if not id then
        message('No networked vehicle is nearby.', 'error')
        return
    end
    TriggerServerEvent('varde_vehicles:server:trunk', id)
end, false)

RegisterCommand('vlock', function()
    local id = networkId(closestVehicle())
    if not id then
        message('No networked vehicle is nearby.', 'error')
        return
    end
    TriggerServerEvent('varde_vehicles:server:toggleLock', id)
end, false)
RegisterKeyMapping('vlock', 'Lock or unlock your Varde vehicle', 'keyboard', 'L')

exports('GetVehicles', function()
    return copy(vehicles)
end)

exports('HasKey', function(vehicleId)
    for _, vehicle in ipairs(vehicles) do
        if vehicle.id == vehicleId then
            return true
        end
    end
    return false
end)

CreateThread(function()
    while not nativeTrue(NetworkIsPlayerActive(PlayerId())) do
        Wait(250)
    end
    if GetResourceState('varde_core') == 'started'
        and exports.varde_core:IsLoggedIn() then
        TriggerServerEvent('varde_vehicles:server:request')
    end
end)

CreateThread(function()
    for _, garage in pairs(config.garages or {}) do
        if garage.blip then
            local blip = AddBlipForCoord(
                garage.menu.x,
                garage.menu.y,
                garage.menu.z
            )
            SetBlipSprite(blip, tonumber(garage.blip.sprite) or 357)
            SetBlipColour(blip, tonumber(garage.blip.color) or 3)
            SetBlipScale(blip, tonumber(garage.blip.scale) or 0.75)
            SetBlipAsShortRange(blip, true)
            BeginTextCommandSetBlipName('STRING')
            AddTextComponentString(garage.label or 'Garage')
            EndTextCommandSetBlipName(blip)
        end
    end
end)

CreateThread(function()
    local nextInteraction = 0
    while true do
        local waitMs = 1000
        local ped = PlayerPedId()
        local coords = GetEntityCoords(ped)
        for _, garage in pairs(config.garages or {}) do
            local menuDistance = distance(coords, garage.menu)
            local storeDistance = distance(coords, garage.store)
            if menuDistance < 25.0 then
                waitMs = 0
                DrawMarker(
                    1,
                    garage.menu.x,
                    garage.menu.y,
                    garage.menu.z - 1.0,
                    0.0, 0.0, 0.0,
                    0.0, 0.0, 0.0,
                    1.4, 1.4, 0.4,
                    80, 170, 255, 150,
                    false, false, 2, false, nil, nil, false
                )
                if menuDistance <= 2.0 then
                    BeginTextCommandDisplayHelp('STRING')
                    AddTextComponentSubstringPlayerName(
                        'Press ~INPUT_CONTEXT~ to view your garage'
                    )
                    EndTextCommandDisplayHelp(0, false, true, -1)
                    if nativeTrue(IsControlJustReleased(0, 38))
                        and GetGameTimer() >= nextInteraction then
                        nextInteraction = GetGameTimer() + 750
                        printGarage()
                    end
                end
            end
            if storeDistance < 25.0 then
                waitMs = 0
                DrawMarker(
                    1,
                    garage.store.x,
                    garage.store.y,
                    garage.store.z - 1.0,
                    0.0, 0.0, 0.0,
                    0.0, 0.0, 0.0,
                    2.3, 2.3, 0.45,
                    90, 220, 130, 150,
                    false, false, 2, false, nil, nil, false
                )
                if storeDistance <= 3.0 and IsPedInAnyVehicle(ped, false) then
                    BeginTextCommandDisplayHelp('STRING')
                    AddTextComponentSubstringPlayerName(
                        'Use /garage store to store this vehicle'
                    )
                    EndTextCommandDisplayHelp(0, false, true, -1)
                end
            end
        end
        Wait(waitMs)
    end
end)
