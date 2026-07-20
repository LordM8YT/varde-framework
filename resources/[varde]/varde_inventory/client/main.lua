local inventory = nil

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

RegisterNetEvent('varde_inventory:client:update', function(snapshot)
    inventory = snapshot
    TriggerEvent('varde_inventory:client:updated', copy(snapshot))
end)

RegisterNetEvent('varde_inventory:client:error', function(text)
    message(text, 'error')
end)

RegisterNetEvent('varde:client:playerLoaded', function()
    TriggerServerEvent('varde_inventory:server:request')
end)

RegisterNetEvent('varde:client:playerLoggedOut', function()
    inventory = nil
end)

RegisterCommand('inventory', function()
    if not inventory then
        message('No inventory is loaded.')
        return
    end
    message(('%s / %s g — %s slots'):format(
        inventory.weight,
        inventory.maxWeight,
        inventory.slots
    ))
    for _, item in ipairs(inventory.items or {}) do
        message(('[%s] %sx %s'):format(item.slot, item.amount, item.label))
    end
end, false)

RegisterCommand('invslot', function(_, args)
    if not args[1] or not args[2] then
        message('Usage: /invslot <from> <to> [amount]', 'error')
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
        message('Usage: /useitem <slot>', 'error')
        return
    end
    TriggerServerEvent('varde_inventory:server:use', tonumber(args[1]))
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

CreateThread(function()
    while not NetworkIsPlayerActive(PlayerId()) do
        Wait(250)
    end
    if GetResourceState('varde_core') == 'started'
        and exports.varde_core:IsLoggedIn() then
        TriggerServerEvent('varde_inventory:server:request')
    end
end)
