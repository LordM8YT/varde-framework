local RESOURCE_NAME = GetCurrentResourceName()
local REQUEST_TIMEOUT_MS = 10000
local requestSequence = 0
local pending = {}
local phoneOpen = false

local function message(text, kind)
    local color = kind == 'error' and { 220, 70, 70 } or { 90, 180, 255 }
    TriggerEvent('chat:addMessage', {
        color = color,
        args = { 'Varde Phone', tostring(text) }
    })
    print(('[varde_phone] %s'):format(tostring(text)))
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
        'varde_phone:server:request',
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
                    message = 'The phone request timed out.'
                }
            })
        end
    end)

    return Citizen.Await(deferred)
end

local function closePhone()
    phoneOpen = false
    SetNuiFocus(false, false)
    SendNUIMessage({ type = 'close' })
end

local function openPhone()
    if phoneOpen then
        closePhone()
        return
    end
    local response = call('bootstrap', {})
    if not response.ok then
        message(response.error and response.error.message or 'Phone unavailable.', 'error')
        return
    end
    phoneOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        type = 'open',
        payload = response.data
    })
end

RegisterNetEvent('varde_phone:client:response', function(requestId, response)
    local resolver = pending[tostring(requestId)]
    if resolver then
        resolver(response)
    end
end)

RegisterNetEvent('varde_phone:client:newMessage', function(incoming)
    if phoneOpen then
        SendNUIMessage({
            type = 'newMessage',
            payload = incoming
        })
    else
        message(('New message from %s'):format(
            incoming.peerName or incoming.peerNumber or 'Unknown'
        ))
    end
end)

RegisterNetEvent('varde_phone:client:messagesRead', function(phoneNumber, readAt)
    if phoneOpen then
        SendNUIMessage({
            type = 'messagesRead',
            payload = {
                phoneNumber = phoneNumber,
                readAt = readAt
            }
        })
    end
end)

RegisterNetEvent('varde_phone:client:contactsUpdated', function()
    if phoneOpen then
        local response = call('bootstrap', {})
        if response.ok then
            SendNUIMessage({
                type = 'bootstrap',
                payload = response.data
            })
        end
    end
end)

RegisterNetEvent('varde:client:playerLoggedOut', function()
    if phoneOpen then
        closePhone()
    end
end)

RegisterCommand('phone', openPhone, false)
RegisterKeyMapping('phone', 'Open Varde Phone', 'keyboard', 'F1')

RegisterNUICallback('phoneRequest', function(data, callback)
    local response = call(data.method, data.payload or {})
    callback(response)
end)

RegisterNUICallback('close', function(_, callback)
    closePhone()
    callback({ ok = true })
end)

AddEventHandler('onResourceStop', function(stoppedResource)
    if stoppedResource ~= RESOURCE_NAME then
        return
    end
    SetNuiFocus(false, false)
    for requestId, resolver in pairs(pending) do
        resolver({
            ok = false,
            error = {
                code = 'RESOURCE_STOPPED',
                message = 'varde_phone stopped'
            }
        })
        pending[requestId] = nil
    end
end)
