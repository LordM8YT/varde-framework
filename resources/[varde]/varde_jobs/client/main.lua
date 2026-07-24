local jobs = {}
local activeJob = nil
local rawConfig = LoadResourceFile(GetCurrentResourceName(), 'config/jobs.json')
local jobConfig = rawConfig and json.decode(rawConfig) or { jobs = {} }

local function locale(key, replacements, fallback)
    return exports.varde_core:Locale(key, replacements, fallback)
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

local function message(text, kind)
    local color = kind == 'error' and { 220, 70, 70 } or { 90, 180, 255 }
    TriggerEvent('chat:addMessage', {
        color = color,
        args = { 'Varde', tostring(text) }
    })
    print(('[varde_jobs] %s'):format(tostring(text)))
end

local function localizeJob(job)
    if type(job) ~= 'table' or type(job.name) ~= 'string' then
        return job
    end
    job.label = locale(
        ('labels.jobs.%s.label'):format(job.name),
        nil,
        job.label or job.name
    )
    if job.grade ~= nil then
        job.gradeLabel = locale(
            ('labels.jobs.%s.grades.%s'):format(job.name, tostring(job.grade)),
            nil,
            job.gradeLabel or tostring(job.grade)
        )
    end
    return job
end

RegisterNetEvent('varde_jobs:client:update', function(snapshot)
    jobs = snapshot and snapshot.jobs or {}
    activeJob = snapshot and snapshot.activeJob or nil
    for _, job in ipairs(jobs) do
        localizeJob(job)
    end
    localizeJob(activeJob)
    TriggerEvent('varde_jobs:client:updated', copy(snapshot))
end)

RegisterNetEvent('varde_jobs:client:message', function(text, kind, code)
    local key = code and ('errors.%s'):format(tostring(code)) or nil
    local translated = key and locale(key) or nil
    message(translated and translated ~= key and translated or text, kind)
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
        message(locale('jobs.noJobs', nil, 'No jobs are available.'))
        return
    end

    for _, job in ipairs(jobs) do
        local marker = job.active and '*' or '-'
        local duty = job.onDuty
            and locale('jobs.onDuty', nil, 'on duty')
            or locale('jobs.offDuty', nil, 'off duty')
        message(locale(
            'jobs.status',
            {
                marker = marker,
                job = job.label,
                grade = job.gradeLabel,
                duty = duty
            },
            ('%s %s — %s (%s)'):format(
                marker,
                job.label,
                job.gradeLabel,
                duty
            )
        ))
    end
end, false)

RegisterCommand('job', function(_, args)
    if not args[1] then
        message(locale('jobs.usageJob', nil, 'Usage: /job <name>'), 'error')
        return
    end
    TriggerServerEvent('varde_jobs:server:setActive', args[1])
end, false)

RegisterCommand('duty', function()
    message(locale(
        'jobs.useDutyMarker',
        nil,
        'Use a duty marker on the map to clock in or out.'
    ))
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
    while not nativeTrue(NetworkIsPlayerActive(PlayerId())) do
        Wait(250)
    end
    if GetResourceState('varde_core') == 'started'
        and exports.varde_core:IsLoggedIn() then
        TriggerServerEvent('varde_jobs:server:request')
    end
end)

CreateThread(function()
    for _, definition in pairs(jobConfig.jobs or {}) do
        for _, point in ipairs(definition.dutyPoints or {}) do
            if point.blip then
                local blip = AddBlipForCoord(point.x, point.y, point.z)
                SetBlipSprite(blip, tonumber(point.blip.sprite) or 1)
                SetBlipColour(blip, tonumber(point.blip.color) or 0)
                SetBlipScale(blip, tonumber(point.blip.scale) or 0.8)
                SetBlipAsShortRange(blip, true)
                BeginTextCommandSetBlipName('STRING')
                AddTextComponentString(point.label or definition.label)
                EndTextCommandSetBlipName(blip)
            end
        end
    end
end)

CreateThread(function()
    local cooldownUntil = 0
    while true do
        local waitMs = 1000
        local ped = PlayerPedId()
        local coords = GetEntityCoords(ped)

        for _, assignment in ipairs(jobs) do
            local definition = jobConfig.jobs
                and jobConfig.jobs[assignment.name]
            for _, point in ipairs(definition and definition.dutyPoints or {}) do
                local pointCoords = vector3(point.x, point.y, point.z)
                local distance = #(coords - pointCoords)
                if distance < 25.0 then
                    waitMs = 0
                    DrawMarker(
                        1,
                        point.x,
                        point.y,
                        point.z - 1.0,
                        0.0,
                        0.0,
                        0.0,
                        0.0,
                        0.0,
                        0.0,
                        1.5,
                        1.5,
                        0.45,
                        70,
                        150,
                        255,
                        150,
                        false,
                        false,
                        2,
                        false,
                        nil,
                        nil,
                        false
                    )
                end
                if distance <= (tonumber(point.radius) or 2.0) then
                    BeginTextCommandDisplayHelp('STRING')
                    AddTextComponentSubstringPlayerName(locale(
                        assignment.onDuty and 'jobs.clockOut' or 'jobs.clockIn',
                        { job = assignment.label },
                        ('Press ~INPUT_CONTEXT~ to clock %s for %s'):format(
                            assignment.onDuty and 'out' or 'in',
                            assignment.label
                        )
                    ))
                    EndTextCommandDisplayHelp(0, false, true, -1)
                    if nativeTrue(IsControlJustReleased(0, 38))
                        and GetGameTimer() >= cooldownUntil then
                        cooldownUntil = GetGameTimer() + 1500
                        TriggerServerEvent(
                            'varde_jobs:server:clock',
                            assignment.name
                        )
                    end
                end
            end
        end
        Wait(waitMs)
    end
end)
