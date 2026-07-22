local RESOURCE_NAME = GetCurrentResourceName()

local isOpen = false
local isLoading = false
local selectedSpawn = 'last'

local function nativeTrue(value)
    return value == true or value == 1
end

local function send(action, data)
    SendNUIMessage({
        action = action,
        data = data
    })
end

local function publicSpawns()
    local spawns = {}
    for _, spawn in ipairs(VardeIdentityConfig.spawns) do
        spawns[#spawns + 1] = {
            id = spawn.id,
            label = spawn.label,
            description = spawn.description
        }
    end
    return spawns
end

local function findSpawn(spawnId)
    for _, spawn in ipairs(VardeIdentityConfig.spawns) do
        if spawn.id == spawnId then
            return spawn
        end
    end
    return VardeIdentityConfig.spawns[1]
end

local function releaseNuiFocus()
    SetNuiFocus(false, false)
    if SetNuiFocusKeepInput then
        SetNuiFocusKeepInput(false)
    end
end

local function closeMenu()
    isOpen = false
    isLoading = false
    releaseNuiFocus()
    send('identity:close')
end

local function refreshMenu(callback)
    exports.varde_core:CallAsync('characters:bootstrap', {}, function(response)
        if response.ok then
            send('identity:update', {
                title = VardeIdentityConfig.title,
                subtitle = VardeIdentityConfig.subtitle,
                allowDelete = VardeIdentityConfig.allowDelete,
                characters = response.data.characters,
                maxCharacters = response.data.maxCharacters,
                spawns = publicSpawns()
            })
        end

        if callback then
            callback(response)
        end
    end, 15000)
end

local function openMenu()
    if isOpen or isLoading or exports.varde_core:IsLoggedIn() then
        return
    end

    isLoading = true
    refreshMenu(function(response)
        isLoading = false
        if not response.ok then
            print(('[varde_identity] Could not open identity: %s'):format(
                response.error and response.error.message or 'unknown error'
            ))
            return
        end

        isOpen = true
        SetNuiFocus(true, true)
        send('identity:open')
    end)
end

RegisterNUICallback('createCharacter', function(data, cb)
    if not isOpen then
        cb({
            ok = false,
            error = { code = 'MENU_CLOSED', message = 'Identity menu is closed.' }
        })
        return
    end

    exports.varde_core:CallAsync('characters:create', data, function(response)
        cb(response)
        if response.ok then
            refreshMenu()
        end
    end)
end)

RegisterNUICallback('deleteCharacter', function(data, cb)
    if not isOpen or not VardeIdentityConfig.allowDelete then
        cb({
            ok = false,
            error = { code = 'DELETE_DISABLED', message = 'Character deletion is disabled.' }
        })
        return
    end

    local characterId = type(data) == 'table' and data.characterId or nil
    exports.varde_core:CallAsync('characters:delete', {
        characterId = characterId,
        confirmation = characterId
    }, function(response)
        cb(response)
        if response.ok then
            refreshMenu()
        end
    end)
end)

RegisterNUICallback('selectCharacter', function(data, cb)
    if not isOpen then
        cb({
            ok = false,
            error = { code = 'MENU_CLOSED', message = 'Identity menu is closed.' }
        })
        return
    end

    selectedSpawn = type(data.spawnId) == 'string' and data.spawnId or 'last'
    exports.varde_core:CallAsync('characters:select', {
        characterId = data.characterId
    }, function(response)
        cb(response)
        if response.ok then
            closeMenu()
        end
    end)
end)

RegisterNUICallback('close', function(_, cb)
    if exports.varde_core:IsLoggedIn() then
        closeMenu()
        cb({ ok = true })
        return
    end

    cb({
        ok = false,
        error = {
            code = 'CHARACTER_REQUIRED',
            message = 'Select a character before closing the menu.'
        }
    })
end)

AddEventHandler('varde_identity:client:spawnRequested', function(snapshot)
    -- The server can request the spawn before the asynchronous NUI callback
    -- has returned. Close the fullscreen frame here as well so it can never
    -- remain above the game after a successful character selection.
    closeMenu()

    local spawn = findSpawn(selectedSpawn)
    local position = snapshot and snapshot.position
    if spawn and not spawn.useLastPosition and spawn.position then
        position = spawn.position
    end

    exports.varde_core:SpawnAt(position)
    selectedSpawn = 'last'
end)

AddEventHandler('varde:client:playerLoggedOut', function()
    SetTimeout(250, openMenu)
end)

RegisterCommand('identity', function()
    openMenu()
end, false)

CreateThread(function()
    while not nativeTrue(NetworkIsPlayerActive(PlayerId())) do
        Wait(250)
    end

    Wait(1000)
    openMenu()
end)

AddEventHandler('onResourceStop', function(stoppedResource)
    if stoppedResource == RESOURCE_NAME then
        releaseNuiFocus()
    end
end)
