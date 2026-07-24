---@class VardePlayerSnapshot
---@field characterId string
---@field profile table
---@field job table
---@field money table
---@field metadata table

---@param source integer
---@param message string
local function reply(source, message)
    if source == 0 then
        print(('[varde_starter] %s'):format(message))
        return
    end

    TriggerClientEvent('chat:addMessage', source, {
        color = { 120, 200, 255 },
        args = { 'Varde', message }
    })
end

---@param value string?
---@return string?
local function normalizeStatus(value)
    local status = type(value) == 'string' and value:lower() or nil
    return status and Config.validStatuses[status] and status or nil
end

---@param playerSource integer
local function initializeStatus(playerSource)
    Player(playerSource).state:set(
        Config.stateKeys.status,
        Config.defaultStatus,
        true
    )
end

-- Core lifecycle events make this resource own the full lifetime of its state.
AddEventHandler('varde:server:playerLoaded', function(playerSource)
    initializeStatus(playerSource)
end)

AddEventHandler('varde:server:playerLoggedOut', function(playerSource)
    Player(playerSource).state:set(Config.stateKeys.status, nil, true)
end)

-- Also supports restarting this resource while players are already online.
for _, player in ipairs(exports['varde_core']:GetPlayers()) do
    initializeStatus(player.source)
end

-- The final `true` delegates authorization to FiveM's native ACE system.
-- Add this to server.cfg for the desired group:
-- add_ace group.admin command.vardestatus allow
RegisterCommand(Config.adminCommand, function(source, args)
    local target = tonumber(args[1])
    local status = normalizeStatus(args[2])

    if not target or not status then
        reply(source, ('Usage: /%s <serverId> <status>'):format(
            Config.adminCommand
        ))
        return
    end

    ---@type VardePlayerSnapshot?
    local player = exports['varde_core']:GetPlayer(target)
    if not player then
        reply(source, ('Player %s has no active Varde character.'):format(
            target
        ))
        return
    end

    -- This resource owns its status key, so it may replicate it directly.
    -- Job changes must instead use varde_core:SetJob(), which also persists them.
    Player(target).state:set(Config.stateKeys.status, status, true)

    reply(source, ('Set %s (%s) to %s.'):format(
        player.profile.firstName,
        target,
        status
    ))
end, true)
