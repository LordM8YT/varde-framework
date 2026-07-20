local RESOURCE_NAME = GetCurrentResourceName()
local REQUEST_TIMEOUT_MS = 10000
local requestSequence = 0
local pending = {}
local panelOpen = false
local frozen = false

local function message(text, kind)
    local color = kind == 'error' and { 220, 70, 70 } or { 90, 180, 255 }
    TriggerEvent('chat:addMessage', {
        color = color,
        args = { 'Varde Admin', tostring(text) }
    })
    print(('[varde_admin] %s'):format(tostring(text)))
end

local function nextRequestId()
    requestSequence = requestSequence + 1
    return ('%s:%s:%s'):format(
        GetPlayerServerId(PlayerId()),
        GetGameTimer(),
        requestSequence
    )
end

local function call(method, payload)
    local requestId = nextRequestId()
    local deferred = promise.new()
    local settled = false

    pending[requestId] = function(response)
        if settled then
            return
        end
        settled = true
        pending[requestId] = nil
        deferred:resolve(response)
    end

    TriggerServerEvent(
        'varde_admin:server:request',
        requestId,
        method,
        payload or {}
    )

    SetTimeout(REQUEST_TIMEOUT_MS, function()
        local resolver = pending[requestId]
        if resolver then
            resolver({
                ok = false,
                error = {
                    code = 'TIMEOUT',
                    message = 'The admin request timed out.'
                }
            })
        end
    end)

    return Citizen.Await(deferred)
end

local function closePanel()
    panelOpen = false
    SetNuiFocus(false, false)
    SendNUIMessage({ type = 'close' })
end

RegisterNetEvent('varde_admin:client:response', function(requestId, response)
    local resolver = pending[tostring(requestId)]
    if resolver then
        resolver(response)
    end
end)

RegisterNetEvent('varde_admin:client:teleport', function(position)
    local x = tonumber(position and position.x)
    local y = tonumber(position and position.y)
    local z = tonumber(position and position.z)
    if not x or not y or not z then
        return
    end
    local ped = PlayerPedId()
    RequestCollisionAtCoord(x, y, z)
    SetEntityCoordsNoOffset(ped, x, y, z + 0.25, false, false, false)
end)

RegisterNetEvent('varde_admin:client:setFrozen', function(value)
    frozen = value == true
    FreezeEntityPosition(PlayerPedId(), frozen)
end)

RegisterNetEvent('varde_admin:client:heal', function()
    local ped = PlayerPedId()
    SetEntityHealth(ped, GetEntityMaxHealth(ped))
    ClearPedBloodDamage(ped)
    ResetPedVisibleDamage(ped)
end)

RegisterCommand('vadmin', function()
    if panelOpen then
        closePanel()
        return
    end
    local response = call('bootstrap', {})
    if not response.ok then
        message(response.error and response.error.message or 'Access denied.', 'error')
        return
    end
    panelOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        type = 'open',
        payload = response.data
    })
end, false)

RegisterNUICallback('adminRequest', function(data, callback)
    local response = call(data.method, data.payload or {})
    callback(response)
end)

RegisterNUICallback('close', function(_, callback)
    closePanel()
    callback({ ok = true })
end)

CreateThread(function()
    while true do
        if frozen then
            FreezeEntityPosition(PlayerPedId(), true)
            Wait(500)
        else
            Wait(1500)
        end
    end
end)

AddEventHandler('onResourceStop', function(stoppedResource)
    if stoppedResource ~= RESOURCE_NAME then
        return
    end
    SetNuiFocus(false, false)
    FreezeEntityPosition(PlayerPedId(), false)
    for requestId, resolver in pairs(pending) do
        resolver({
            ok = false,
            error = {
                code = 'RESOURCE_STOPPED',
                message = 'varde_admin stopped'
            }
        })
        pending[requestId] = nil
    end
end)
