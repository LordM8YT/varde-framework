local inventory = nil
local openPayload = nil
local drops = {}
local pendingRequests = {}
local requestSequence = 0
local uiOpen = false

local function locale(key, replacements, fallback)
    return exports.varde_core:Locale(key, replacements, fallback)
end

local function localizeResponse(response)
    if type(response) ~= 'table' or response.ok ~= false
        or type(response.error) ~= 'table' then
        return response
    end
    local code = tostring(response.error.code or '')
    if code ~= '' then
        local key = ('errors.%s'):format(code)
        local translated = locale(key)
        if translated ~= key then
            response.error.message = translated
        end
    end
    return response
end

local uiConfig = {
    enabled = false,
    hotbarSlots = 5,
    showDropMarkers = true
}

do
    local raw = LoadResourceFile(GetCurrentResourceName(), 'config/ui.json')
    if raw then
        local ok, parsed = pcall(json.decode, raw)
        if ok and type(parsed) == 'table' then
            uiConfig.enabled = parsed.enabled == true
            uiConfig.hotbarSlots = tonumber(parsed.hotbarSlots) or 5
            uiConfig.showDropMarkers = parsed.showDropMarkers ~= false
        end
    end
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

local function localizeInventory(value)
    if type(value) ~= 'table' then
        return value
    end
    for _, item in ipairs(value.items or {}) do
        if type(item.name) == 'string' then
            item.label = locale(
                ('labels.items.%s'):format(item.name),
                nil,
                item.label or item.name
            )
        end
    end
    return value
end

local function message(text, kind)
    local color = kind == 'error' and { 220, 70, 70 } or { 90, 180, 255 }
    TriggerEvent('chat:addMessage', {
        color = color,
        args = { 'Varde', tostring(text) }
    })
    print(('[varde_inventory] %s'):format(tostring(text)))
end

local function getItemCount(itemName)
    local count = 0
    if inventory then
        for _, item in ipairs(inventory.items or {}) do
            if item.name == itemName then
                count = count + item.amount
            end
        end
    end
    return count
end

local function closeInventory(notifyServer)
    if not uiOpen and not openPayload then
        return
    end
    uiOpen = false
    openPayload = nil
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'varde:inventory:close' })
    TriggerEvent('varde_inventory:client:closed')
    if notifyServer ~= false then
        requestSequence = requestSequence + 1
        TriggerServerEvent(
            'varde_inventory:server:nui',
            ('close:%s:%s'):format(GetGameTimer(), requestSequence),
            'close',
            {}
        )
    end
end

local function present(payload)
    payload = copy(payload) or {}
    localizeInventory(payload.player)
    localizeInventory(payload.secondary)
    openPayload = copy(payload)
    TriggerEvent('varde_inventory:client:uiOpenRequested', copy(payload))

    if not uiConfig.enabled then
        local playerInventory = payload and payload.player
        if not playerInventory then
            message(locale(
                'inventory.noInventory',
                nil,
                'No inventory is loaded.'
            ), 'error')
            return
        end
        message(locale(
            'inventory.summary',
            {
                weight = playerInventory.weight,
                maxWeight = playerInventory.maxWeight,
                slots = playerInventory.slots
            },
            ('%s / %s g - %s slots'):format(
                playerInventory.weight,
                playerInventory.maxWeight,
                playerInventory.slots
            )
        ))
        for _, item in ipairs(playerInventory.items or {}) do
            message(locale(
                'inventory.item',
                {
                    slot = item.slot,
                    amount = item.amount,
                    label = item.label
                },
                ('[%s] %sx %s'):format(item.slot, item.amount, item.label)
            ))
        end
        if payload.secondary then
            message(locale(
                'inventory.opened',
                { label = payload.secondary.label },
                ('Opened: %s'):format(payload.secondary.label)
            ))
        end
        return
    end

    uiOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        action = 'varde:inventory:open',
        payload = payload,
        localeName = exports.varde_core:GetLocale(),
        locale = {
            inventory = exports.varde_core:GetLocaleData('inventory'),
            labels = exports.varde_core:GetLocaleData('labels')
        }
    })
end

local function request(method, payload, callback)
    requestSequence = requestSequence + 1
    local requestId = ('%s:%s'):format(GetGameTimer(), requestSequence)
    if callback then
        pendingRequests[requestId] = callback
        SetTimeout(10000, function()
            local pending = pendingRequests[requestId]
            if pending then
                pendingRequests[requestId] = nil
                pending({
                    ok = false,
                    error = {
                        code = 'TIMEOUT',
                        message = locale(
                            'inventory.requestTimedOut',
                            nil,
                            'Inventory request timed out.'
                        )
                    }
                })
            end
        end)
    end
    TriggerServerEvent(
        'varde_inventory:server:nui',
        requestId,
        method,
        payload or {}
    )
end

RegisterNetEvent('varde_inventory:client:update', function(snapshot)
    snapshot = localizeInventory(copy(snapshot))
    inventory = snapshot
    if openPayload then
        openPayload.player = copy(snapshot)
    end
    if uiOpen then
        SendNUIMessage({
            action = 'varde:inventory:update',
            payload = { player = snapshot }
        })
    end
    TriggerEvent('varde_inventory:client:updated', copy(snapshot))
end)

RegisterNetEvent('varde_inventory:client:open', function(payload)
    present(payload)
end)

RegisterNetEvent('varde_inventory:client:nuiResponse', function(requestId, response)
    response = localizeResponse(response)
    local callback = pendingRequests[tostring(requestId)]
    pendingRequests[tostring(requestId)] = nil
    if callback then
        callback(response)
    end
    if response and response.ok and type(response.data) == 'table'
        and response.data.contract == 'varde.inventory.bootstrap.v1' then
        openPayload = copy(response.data)
        if uiOpen then
            SendNUIMessage({
                action = 'varde:inventory:update',
                payload = response.data
            })
        end
    elseif response and not response.ok and response.error then
        message(
            response.error.message
                or locale(
                    'inventory.requestFailed',
                    nil,
                    'Inventory request failed.'
                ),
            'error'
        )
    end
end)

RegisterNetEvent('varde_inventory:client:drops', function(entries)
    drops = {}
    for _, drop in ipairs(entries or {}) do
        if type(drop) == 'table' and drop.id and drop.position then
            drops[drop.id] = drop
        end
    end
end)

RegisterNetEvent('varde_inventory:client:dropCreated', function(drop)
    if type(drop) == 'table' and drop.id and drop.position then
        drops[drop.id] = drop
    end
end)

RegisterNetEvent('varde_inventory:client:dropRemoved', function(dropId)
    drops[tostring(dropId)] = nil
    if openPayload and openPayload.secondary
        and openPayload.secondary.id == tostring(dropId) then
        closeInventory(false)
    end
end)

RegisterNetEvent('varde_inventory:client:error', function(text, code)
    local key = code and ('errors.%s'):format(tostring(code)) or nil
    local translated = key and locale(key) or nil
    message(translated and translated ~= key and translated or text, 'error')
end)

RegisterNetEvent('varde:client:playerLoaded', function()
    TriggerServerEvent('varde_inventory:server:request')
    TriggerServerEvent('varde_inventory:server:requestDrops')
end)

RegisterNetEvent('varde:client:playerLoggedOut', function()
    closeInventory(false)
    inventory = nil
    drops = {}
end)

RegisterNUICallback('inventoryRequest', function(data, callback)
    local method = type(data) == 'table' and data.method or nil
    local payload = type(data) == 'table' and data.payload or {}
    if method == 'close' then
        closeInventory(true)
        callback({ ok = true, data = true })
        return
    end
    request(method, payload, callback)
end)

RegisterCommand('inventory', function()
    request('bootstrap', {}, function(response)
        if response and response.ok then
            present(response.data)
        end
    end)
end, false)

RegisterCommand('invslot', function(_, args)
    if not args[1] or not args[2] then
        message(locale(
            'inventory.usageMove',
            nil,
            'Usage: /invslot <from> <to> [amount]'
        ), 'error')
        return
    end
    TriggerServerEvent(
        'varde_inventory:server:move',
        tonumber(args[1]),
        tonumber(args[2]),
        args[3] and tonumber(args[3]) or nil
    )
end, false)

RegisterCommand('useitem', function(_, args)
    if not args[1] then
        message(locale('inventory.usageUse', nil, 'Usage: /useitem <slot>'), 'error')
        return
    end
    TriggerServerEvent('varde_inventory:server:use', tonumber(args[1]))
end, false)

RegisterCommand('dropitem', function(_, args)
    if not args[1] then
        message(locale(
            'inventory.usageDrop',
            nil,
            'Usage: /dropitem <slot> [amount]'
        ), 'error')
        return
    end
    request('drop', {
        side = 'player',
        slot = tonumber(args[1]),
        amount = args[2] and tonumber(args[2]) or nil
    })
end, false)

RegisterCommand('takeitem', function(_, args)
    if not args[1] then
        message(locale(
            'inventory.usageTake',
            nil,
            'Usage: /takeitem <secondary slot> [amount] [player slot]'
        ), 'error')
        return
    end
    request('transfer', {
        from = 'secondary',
        to = 'player',
        fromSlot = tonumber(args[1]),
        amount = args[2] and tonumber(args[2]) or nil,
        toSlot = args[3] and tonumber(args[3]) or nil
    })
end, false)

RegisterCommand('putitem', function(_, args)
    if not args[1] then
        message(locale(
            'inventory.usagePut',
            nil,
            'Usage: /putitem <player slot> [amount] [secondary slot]'
        ), 'error')
        return
    end
    request('transfer', {
        from = 'player',
        to = 'secondary',
        fromSlot = tonumber(args[1]),
        amount = args[2] and tonumber(args[2]) or nil,
        toSlot = args[3] and tonumber(args[3]) or nil
    })
end, false)

exports('GetInventory', function()
    return copy(inventory)
end)

exports('GetItemCount', function(itemName)
    return getItemCount(itemName)
end)

exports('HasItem', function(itemName, amount)
    return getItemCount(itemName) >= (tonumber(amount) or 1)
end)

exports('Open', function()
    request('bootstrap', {}, function(response)
        if response and response.ok then
            present(response.data)
        end
    end)
end)

exports('Close', function()
    closeInventory(true)
end)

CreateThread(function()
    while not nativeTrue(NetworkIsPlayerActive(PlayerId())) do
        Wait(250)
    end
    if GetResourceState('varde_core') == 'started'
        and exports.varde_core:IsLoggedIn() then
        TriggerServerEvent('varde_inventory:server:request')
        TriggerServerEvent('varde_inventory:server:requestDrops')
    end
end)

CreateThread(function()
    local nextOpenAt = 0
    while true do
        local sleep = 750
        if uiConfig.showDropMarkers and next(drops) then
            local ped = PlayerPedId()
            local coords = GetEntityCoords(ped)
            for dropId, drop in pairs(drops) do
                local position = drop.position
                local dx = coords.x - position.x
                local dy = coords.y - position.y
                local dz = coords.z - position.z
                local distance = math.sqrt(dx * dx + dy * dy + dz * dz)
                if distance < 25.0 then
                    sleep = 0
                    DrawMarker(
                        2,
                        position.x,
                        position.y,
                        position.z + 0.15,
                        0.0, 0.0, 0.0,
                        0.0, 0.0, 0.0,
                        0.18, 0.18, 0.18,
                        90, 180, 255, 170,
                        false, true, 2, false, nil, nil, false
                    )
                    if distance <= 2.0 and IsControlJustReleased(0, 38)
                        and GetGameTimer() >= nextOpenAt then
                        nextOpenAt = GetGameTimer() + 750
                        TriggerServerEvent('varde_inventory:server:openDrop', dropId)
                    end
                end
            end
        end
        Wait(sleep)
    end
end)

AddEventHandler('onResourceStop', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then
        return
    end
    SetNuiFocus(false, false)
    for requestId, callback in pairs(pendingRequests) do
        pendingRequests[requestId] = nil
        callback({
            ok = false,
            error = {
                code = 'RESOURCE_STOPPED',
                message = locale(
                    'inventory.resourceStopped',
                    nil,
                    'Inventory resource stopped.'
                )
            }
        })
    end
end)
