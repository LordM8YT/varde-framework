local needs = nil
local playerData = nil
local lastSnapshotJson = nil

local function locale(key, replacements, fallback)
    return exports.varde_core:Locale(key, replacements, fallback)
end

local function nativeTrue(value)
    return value == true or value == 1
end

local function copy(value)
    if value == nil then
        return nil
    end
    return json.decode(json.encode(value))
end

local function clamp(value, minimum, maximum)
    return math.max(minimum, math.min(maximum, value))
end

local function rounded(value)
    return math.floor((tonumber(value) or 0) + 0.5)
end

local function playerName()
    local profile = playerData and playerData.profile or {}
    local firstName = tostring(profile.firstName or '')
    local lastName = tostring(profile.lastName or '')
    return (firstName .. ' ' .. lastName):gsub('^%s+', ''):gsub('%s+$', '')
end

local function localizedJob()
    local job = copy(playerData and playerData.job)
    if not job or type(job.name) ~= 'string' then
        return job
    end
    job.label = locale(
        ('labels.jobs.%s.label'):format(job.name),
        nil,
        job.label or job.name
    )
    if job.grade ~= nil then
        job.gradeLabel = locale(
            ('labels.jobs.%s.grades.%s'):format(job.name, tostring(job.grade)),
            nil,
            job.gradeLabel or tostring(job.grade)
        )
    end
    return job
end

local function pedVitals()
    local ped = PlayerPedId()
    if ped == 0 or not nativeTrue(DoesEntityExist(ped)) then
        return 0, 0, 0
    end

    local maximum = math.max(1, GetEntityMaxHealth(ped) - 100)
    local health = clamp(
        rounded(((GetEntityHealth(ped) - 100) / maximum) * 100),
        0,
        100
    )
    local armor = clamp(rounded(GetPedArmour(ped)), 0, 100)
    local stamina = clamp(
        rounded(GetPlayerSprintStaminaRemaining(PlayerId())),
        0,
        100
    )
    return health, armor, stamina
end

local function vehicleSnapshot()
    local ped = PlayerPedId()
    if ped == 0 or not nativeTrue(IsPedInAnyVehicle(ped, false)) then
        return nil
    end
    local vehicle = GetVehiclePedIsIn(ped, false)
    if vehicle == 0 or not nativeTrue(DoesEntityExist(vehicle)) then
        return nil
    end
    return {
        speed = rounded(GetEntitySpeed(vehicle) * 3.6),
        speedUnit = 'kmh',
        rpm = clamp(rounded(GetVehicleCurrentRpm(vehicle) * 100), 0, 100),
        gear = GetVehicleCurrentGear(vehicle),
        fuel = clamp(rounded(GetVehicleFuelLevel(vehicle)), 0, 100),
        engineHealth = clamp(
            rounded(GetVehicleEngineHealth(vehicle) / 10),
            0,
            100
        ),
        plate = tostring(GetVehicleNumberPlateText(vehicle) or ''):gsub('%s+$', '')
    }
end

local function buildHudSnapshot()
    if not playerData or not needs then
        return nil
    end
    local health, armor, stamina = pedVitals()
    local vehicle = vehicleSnapshot()
    local ped = PlayerPedId()
    return {
        contract = 'varde.hud.bootstrap.v1',
        player = {
            characterId = playerData.characterId,
            name = playerName(),
            job = localizedJob(),
            money = copy(playerData.money)
        },
        status = {
            health = health,
            armor = armor,
            hunger = rounded(needs.hunger),
            thirst = rounded(needs.thirst),
            stress = rounded(needs.stress),
            stamina = stamina
        },
        vehicle = vehicle,
        visibility = {
            hud = true,
            minimap = true,
            money = false,
            job = true,
            weapon = ped ~= 0 and nativeTrue(IsPedArmed(ped, 7)),
            vehicle = vehicle ~= nil
        }
    }
end

local function publishHud(force)
    local snapshot = buildHudSnapshot()
    local encoded = snapshot and json.encode(snapshot) or ''
    if force or encoded ~= lastSnapshotJson then
        lastSnapshotJson = encoded
        TriggerEvent('varde_status:client:hudUpdated', copy(snapshot))
    end
    return snapshot
end

RegisterNetEvent('varde_status:client:update', function(snapshot)
    needs = copy(snapshot)
    publishHud(true)
end)

RegisterNetEvent('varde:client:playerLoaded', function(snapshot)
    playerData = copy(snapshot)
    TriggerServerEvent('varde_status:server:request')
end)

RegisterNetEvent('varde:client:playerUpdated', function(snapshot)
    playerData = copy(snapshot)
    publishHud(true)
end)

RegisterNetEvent('varde:client:playerLoggedOut', function()
    needs = nil
    playerData = nil
    lastSnapshotJson = nil
    TriggerEvent('varde_status:client:hudUpdated', nil)
end)

exports('GetStatus', function()
    return copy(needs)
end)

exports('GetHudData', function()
    return copy(buildHudSnapshot())
end)

CreateThread(function()
    while not nativeTrue(NetworkIsPlayerActive(PlayerId())) do
        Wait(250)
    end
    if GetResourceState('varde_core') == 'started'
        and exports.varde_core:IsLoggedIn() then
        playerData = exports.varde_core:GetPlayerData()
        TriggerServerEvent('varde_status:server:request')
    end
end)

CreateThread(function()
    while true do
        Wait(playerData and 500 or 1000)
        if playerData and needs then
            publishHud(false)
        end
    end
end)
