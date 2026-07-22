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

-- GTAV Enhanced early access can expose native BOOL results as 0/1. Lua
-- treats numeric 0 as truthy, so normalize before using native results in
-- conditions or sending them to the server.
local function nativeTrue(value)
    return value == true or value == 1
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

local function isCallable(value)
    if type(value) == 'function' then
        return true
    end

    if type(value) ~= 'table' then
        return false
    end

    local metatable = getmetatable(value)
    return type(metatable) == 'table'
        and type(rawget(metatable, '__call')) == 'function'
end

local function callAsync(method, payload, callback, timeoutMs)
    assert(type(method) == 'string', 'method must be a string')
    assert(isCallable(callback), 'callback must be callable')

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

local function shutdownLoadingScreens()
    -- Enhanced currently keeps the Cfx loadingScreen NUI separate from the
    -- game loading screen. Both must be dismissed after the player is ready.
    ShutdownLoadingScreen()
    ShutdownLoadingScreenNui()
end

local function reportSpawnDiagnostics()
    local ped = PlayerPedId()
    local pedExists = ped ~= 0 and nativeTrue(DoesEntityExist(ped))
    local coords = pedExists and GetEntityCoords(ped) or vector3(0.0, 0.0, 0.0)
    TriggerServerEvent('varde:server:spawnDiagnostics', {
        model = pedExists and GetEntityModel(ped) or 0,
        pedExists = pedExists,
        pedVisible = pedExists and nativeTrue(IsEntityVisible(ped)),
        screenFadedIn = nativeTrue(IsScreenFadedIn()),
        screenFadedOut = nativeTrue(IsScreenFadedOut()),
        gameplayCamRendering = nativeTrue(IsGameplayCamRendering()),
        playerSwitchInProgress = nativeTrue(IsPlayerSwitchInProgress()),
        networkPlayerActive = nativeTrue(NetworkIsPlayerActive(PlayerId())),
        position = {
            x = coords.x,
            y = coords.y,
            z = coords.z
        }
    })
end

local spawnSequence = 0

local function spawnAt(position)
    if type(position) ~= 'table' then
        return false
    end

    local x = tonumber(position.x)
    local y = tonumber(position.y)
    local z = tonumber(position.z)
    local heading = tonumber(position.heading) or 0.0
    if not x or not y or not z then
        return false
    end

    if GetResourceState('spawnmanager') ~= 'started' then
        print('[varde_core] Spawn failed: spawnmanager is not started.')
        return false
    end

    spawnSequence = spawnSequence + 1
    local sequence = spawnSequence
    local completed = false

    exports.spawnmanager:spawnPlayer({
        x = x,
        y = y,
        z = z,
        heading = heading,
        skipFade = false
    }, function()
        completed = true
        CreateThread(function()
            local readyStartedAt = GetGameTimer()
            while (not nativeTrue(NetworkIsPlayerActive(PlayerId()))
                or not nativeTrue(DoesEntityExist(PlayerPedId())))
                and (GetGameTimer() - readyStartedAt) < 10000 do
                Wait(0)
            end

            local ped = PlayerPedId()
            if ped ~= 0 and nativeTrue(DoesEntityExist(ped)) then
                FreezeEntityPosition(ped, false)
                SetEntityVisible(ped, true, false)
                SetEntityCollision(ped, true, true)
                SetEntityInvincible(ped, false)
            end
            SetPlayerControl(PlayerId(), true, false)

            if nativeTrue(IsPlayerSwitchInProgress()) then
                StopPlayerSwitch()
            end
            ClearFocus()
            RenderScriptCams(false, false, 0, true, true)
            shutdownLoadingScreens()
            DoScreenFadeIn(500)

            Wait(500)
            shutdownLoadingScreens()

            local spawned = nativeTrue(NetworkIsPlayerActive(PlayerId()))
                and nativeTrue(DoesEntityExist(PlayerPedId()))
            if spawned then
                print(('[varde_core] Spawned player at %.2f, %.2f, %.2f.'):format(
                    x,
                    y,
                    z
                ))
            else
                print('[varde_core] Spawn incomplete: Cfx did not create an active player ped.')
            end
            reportSpawnDiagnostics()
        end)
    end)

    SetTimeout(15000, function()
        if completed or spawnSequence ~= sequence then
            return
        end

        shutdownLoadingScreens()
        DoScreenFadeIn(0)
        if nativeTrue(IsPlayerSwitchInProgress()) then
            StopPlayerSwitch()
        end
        ClearFocus()
        RenderScriptCams(false, false, 0, true, true)
        reportSpawnDiagnostics()
    end)

    return true
end

local function loadPlayer(snapshot)
    playerData = snapshot
    if GetResourceState('varde_identity') == 'started' then
        TriggerEvent('varde_identity:client:spawnRequested', copy(snapshot))
    else
        spawnAt(snapshot and snapshot.position)
    end
end

RegisterNetEvent('varde:client:rpcResponse', function(requestId, response)
    local resolver = pending[tostring(requestId)]
    if resolver then
        resolver(response)
    end
end)

RegisterNetEvent('varde:client:playerLoaded', function(snapshot)
    loadPlayer(snapshot)
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
exports('GetCharacterBootstrap', function()
    return call('characters:bootstrap', {})
end)
exports('CreateCharacter', function(character)
    return call('characters:create', character)
end)
exports('DeleteCharacter', function(characterId)
    return call('characters:delete', {
        characterId = characterId,
        confirmation = characterId
    })
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
exports('SpawnAt', function(position)
    spawnAt(position)
end)

CreateThread(function()
    while not nativeTrue(NetworkIsPlayerActive(PlayerId())) do
        Wait(250)
    end

    local response = call('session:current', {}, 15000)
    if response.ok and response.data then
        loadPlayer(response.data)
    end
end)

CreateThread(function()
    while true do
        Wait(positionSyncMs)
        if playerData then
            local ped = PlayerPedId()
            if ped ~= 0 and nativeTrue(DoesEntityExist(ped)) then
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
