---@class VardeJob
---@field name string
---@field label string
---@field type string
---@field grade integer
---@field gradeLabel string
---@field payment integer
---@field onDuty boolean

---@class VardeObservedState
---@field job VardeJob?
---@field status string?

---@type VardeObservedState
local observed = {
    job = nil,
    status = nil
}

---Returns true only for the local player's replicated State Bag.
---@param bagName string
---@return boolean
local function isLocalPlayerBag(bagName)
    local serverId = bagName:match('^player:(%d+)$')
    return serverId ~= nil
        and tonumber(serverId) == GetPlayerServerId(PlayerId())
end

---@param message string
local function debugLog(message)
    if Config.debug then
        print(('[varde_starter] %s'):format(message))
    end
end

---@param job VardeJob?
local function setObservedJob(job)
    local previous = observed.job
    observed.job = job

    if job then
        debugLog(('job changed to %s (grade %s)'):format(
            job.name,
            tostring(job.gradeLabel or job.grade or 0)
        ))
    else
        debugLog('job state was cleared')
    end

    -- Other client modules can react without polling or depending on this file.
    TriggerEvent('varde_starter:client:jobChanged', job, previous)
end

---@param status string?
local function setObservedStatus(status)
    local previous = observed.status
    observed.status = status
    debugLog(('status changed to %s'):format(status or 'unset'))

    TriggerEvent('varde_starter:client:statusChanged', status, previous)
end

-- State Bag handlers run only when the matching key changes. There is no idle loop.
AddStateBagChangeHandler(Config.stateKeys.job, nil, function(
    bagName,
    _key,
    value
)
    if isLocalPlayerBag(bagName) then
        setObservedJob(value)
    end
end)

AddStateBagChangeHandler(Config.stateKeys.status, nil, function(
    bagName,
    _key,
    value
)
    if isLocalPlayerBag(bagName) then
        setObservedStatus(value)
    end
end)

-- Read the current values once in case this resource starts after replication.
setObservedJob(LocalPlayer.state[Config.stateKeys.job])
setObservedStatus(LocalPlayer.state[Config.stateKeys.status])

-- A small local event demonstrating a direct, public Varde Core export call.
-- Trigger it from another client module with:
-- TriggerEvent('varde_starter:client:printPlayer')
RegisterNetEvent('varde_starter:client:printPlayer', function()
    local player = exports['varde_core']:GetPlayerData()
    if not player then
        debugLog('no character is currently loaded')
        return
    end

    debugLog(('active character: %s'):format(player.characterId))
end)
