local RESOURCE_NAME = GetCurrentResourceName()
local DEFAULT_TIMEOUT_MS = 10000

local rawConfig = LoadResourceFile(RESOURCE_NAME, 'config/defaults.json')
local config = rawConfig and json.decode(rawConfig) or {}
local positionSyncMs = tonumber(config.positionSyncMs) or 15000

local requestSequence = 0
local pending = {}
local playerData = nil

local function copy(value)
    if value == nil then
        return nil
    end
    return json.decode(json.encode(value))
end

local function nextRequestId()
    requestSequence = requestSequence + 1
    if requestSequence > 999999 then
        requestSequence = 1
    end

    return ('%s:%s:%s'):format(
        GetPlayerServerId(PlayerId()),
        GetGameTimer(),
        requestSequence
    )
end

local function callAsync(method, payload, callback, timeoutMs)
    assert(type(method) == 'string', 'method must be a string')
    assert(type(callback) == 'function', 'callback must be a function')

    local requestId = nextRequestId()
    local settled = false

    pending[requestId] = function(response)
        if settled then
            return
        end
        settled = true
        pending[requestId] = nil
        callback(response)
    end

    TriggerServerEvent('varde:server:rpc', requestId, method, payload or {})

    SetTimeout(timeoutMs or DEFAULT_TIMEOUT_MS, function()
        local resolver = pending[requestId]
        if resolver then
            resolver({
                ok = false,
                error = {
                    code = 'TIMEOUT',
                    message = ('RPC %s timed out'):format(method)
                }
            })
        end
    end)

    return requestId
end

local function call(method, payload, timeoutMs)
    local deferred = promise.new()
    callAsync(method, payload, function(response)
        deferred:resolve(response)
    end, timeoutMs)
    return Citizen.Await(deferred)
end

local function spawnAt(position)
    if type(position) ~= 'table' then
        return
    end

    CreateThread(function()
        local x = tonumber(position.x)
        local y = tonumber(position.y)
        local z = tonumber(position.z)
        local heading = tonumber(position.heading) or 0.0
        if not x or not y or not z then
            return
        end

        while not NetworkIsPlayerActive(PlayerId()) do
            Wait(0)
        end

        DoScreenFadeOut(250)
        while not IsScreenFadedOut() do
            Wait(0)
        end

        RequestCollisionAtCoord(x, y, z)
        NetworkResurrectLocalPlayer(x, y, z, heading, true, false)

        local ped = PlayerPedId()
        FreezeEntityPosition(ped, true)
        SetEntityCoordsNoOffset(ped, x, y, z, false, false, false)
        SetEntityHeading(ped, heading)
        ClearPedTasksImmediately(ped)
        SetEntityInvincible(ped, false)

        local deadline = GetGameTimer() + 5000
        while not HasCollisionLoadedAroundEntity(ped) and GetGameTimer() < deadline do
            RequestCollisionAtCoord(x, y, z)
            Wait(0)
        end

        FreezeEntityPosition(ped, false)
        ShutdownLoadingScreen()
        ShutdownLoadingScreenNui()
        DoScreenFadeIn(250)
    end)
end

RegisterNetEvent('varde:client:rpcResponse', function(requestId, response)
    local resolver = pending[tostring(requestId)]
    if resolver then
        resolver(response)
    end
end)

RegisterNetEvent('varde:client:playerLoaded', function(snapshot)
    playerData = snapshot
    spawnAt(snapshot and snapshot.position)
end)

RegisterNetEvent('varde:client:playerUpdated', function(snapshot)
    playerData = snapshot
end)

RegisterNetEvent('varde:client:playerLoggedOut', function()
    playerData = nil
end)

exports('Call', call)
exports('CallAsync', callAsync)
exports('ListCharacters', function()
    return call('characters:list', {})
end)
exports('CreateCharacter', function(character)
    return call('characters:create', character)
end)
exports('SelectCharacter', function(characterId)
    return call('characters:select', { characterId = characterId })
end)
exports('Logout', function()
    return call('session:logout', {})
end)
exports('GetPlayerData', function()
    return copy(playerData)
end)
exports('IsLoggedIn', function()
    return playerData ~= nil
end)

CreateThread(function()
    while not NetworkIsPlayerActive(PlayerId()) do
        Wait(250)
    end

    local response = call('session:current', {}, 15000)
    if response.ok and response.data then
        playerData = response.data
    end
end)

CreateThread(function()
    while true do
        Wait(positionSyncMs)
        if playerData then
            local ped = PlayerPedId()
            if ped ~= 0 and DoesEntityExist(ped) then
                local coords = GetEntityCoords(ped)
                TriggerServerEvent('varde:server:updatePosition', {
                    x = coords.x,
                    y = coords.y,
                    z = coords.z,
                    heading = GetEntityHeading(ped)
                })
            end
        end
    end
end)

AddEventHandler('onResourceStop', function(stoppedResource)
    if stoppedResource ~= RESOURCE_NAME then
        return
    end

    for requestId, resolver in pairs(pending) do
        resolver({
            ok = false,
            error = {
                code = 'RESOURCE_STOPPED',
                message = 'varde_core stopped'
            }
        })
        pending[requestId] = nil
    end
end)
