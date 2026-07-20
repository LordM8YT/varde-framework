local jobs = {}
local activeJob = nil

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
    print(('[varde_jobs] %s'):format(tostring(text)))
end

RegisterNetEvent('varde_jobs:client:update', function(snapshot)
    jobs = snapshot and snapshot.jobs or {}
    activeJob = snapshot and snapshot.activeJob or nil
    TriggerEvent('varde_jobs:client:updated', copy(snapshot))
end)

RegisterNetEvent('varde_jobs:client:message', function(text, kind)
    message(text, kind)
end)

RegisterNetEvent('varde:client:playerLoggedOut', function()
    jobs = {}
    activeJob = nil
end)

RegisterNetEvent('varde:client:playerLoaded', function()
    TriggerServerEvent('varde_jobs:server:request')
end)

RegisterCommand('jobs', function()
    if #jobs == 0 then
        message('No jobs are available.')
        return
    end

    for _, job in ipairs(jobs) do
        local marker = job.active and '*' or '-'
        local duty = job.onDuty and 'on duty' or 'off duty'
        message(('%s %s — %s (%s)'):format(
            marker,
            job.label,
            job.gradeLabel,
            duty
        ))
    end
end, false)

RegisterCommand('job', function(_, args)
    if not args[1] then
        message('Usage: /job <name>', 'error')
        return
    end
    TriggerServerEvent('varde_jobs:server:setActive', args[1])
end, false)

RegisterCommand('duty', function()
    TriggerServerEvent('varde_jobs:server:toggleDuty')
end, false)

exports('GetJobs', function()
    return copy(jobs)
end)

exports('GetActiveJob', function()
    return copy(activeJob)
end)

exports('HasPermission', function(permission, requireDuty)
    if not activeJob or type(permission) ~= 'string' then
        return false
    end
    if requireDuty ~= false and not activeJob.onDuty then
        return false
    end
    for _, granted in ipairs(activeJob.permissions or {}) do
        if granted == '*' or granted == permission then
            return true
        end
    end
    return false
end)

CreateThread(function()
    while not NetworkIsPlayerActive(PlayerId()) do
        Wait(250)
    end
    if GetResourceState('varde_core') == 'started'
        and exports.varde_core:IsLoggedIn() then
        TriggerServerEvent('varde_jobs:server:request')
    end
end)
