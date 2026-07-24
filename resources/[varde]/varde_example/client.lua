local function message(text, color)
    print(('[varde_example] %s'):format(text))
    TriggerEvent('chat:addMessage', {
        color = color or { 160, 210, 255 },
        args = { 'Varde', text }
    })
end

local function showError(response)
    local error = response and response.error or {}
    message(('%s: %s'):format(
        error.code or 'UNKNOWN_ERROR',
        error.message or locale('example.unknownError', nil, 'unknown error')
    ), { 255, 100, 100 })
end

RegisterCommand('characters', function()
    exports.varde_core:CallAsync('characters:list', {}, function(response)
        if not response.ok then
            showError(response)
            return
        end

        if #response.data == 0 then
            message(locale(
                'example.noCharacters',
                nil,
                'No characters. Use /newchar <slot> <first> <last> <YYYY-MM-DD>.'
            ))
            return
        end

        for _, character in ipairs(response.data) do
            message(('[%s] %s %s — %s'):format(
                character.slot,
                character.profile.firstName,
                character.profile.lastName,
                character.characterId
            ))
        end
    end)
end, false)

RegisterCommand('newchar', function(_, args)
    local slot = tonumber(args[1])
    local firstName = args[2]
    local lastName = args[3]
    local birthDate = args[4]

    if not slot or not firstName or not lastName or not birthDate then
        message(locale(
            'example.usageNewCharacter',
            nil,
            'Usage: /newchar <slot> <first> <last> <YYYY-MM-DD>'
        ))
        return
    end

    exports.varde_core:CallAsync('characters:create', {
        slot = slot,
        firstName = firstName,
        lastName = lastName,
        birthDate = birthDate,
        gender = 'unspecified',
        nationality = 'Unknown'
    }, function(response)
        if not response.ok then
            showError(response)
            return
        end
        message(locale(
            'example.characterCreated',
            {
                firstName = response.data.profile.firstName,
                lastName = response.data.profile.lastName,
                characterId = response.data.characterId
            },
            ('Created %s %s with id %s. Use /playchar %s.'):format(
                response.data.profile.firstName,
                response.data.profile.lastName,
                response.data.characterId,
                response.data.characterId
            )
        ), { 120, 255, 160 })
    end)
end, false)

RegisterCommand('playchar', function(_, args)
    if not args[1] then
        message(locale(
            'example.usagePlayCharacter',
            nil,
            'Usage: /playchar <characterId>'
        ))
        return
    end

    exports.varde_core:CallAsync(
        'characters:select',
        { characterId = args[1] },
        function(response)
            if not response.ok then
                showError(response)
                return
            end
            message(locale(
                'example.loggedIn',
                {
                    firstName = response.data.profile.firstName,
                    lastName = response.data.profile.lastName
                },
                ('Logged in as %s %s.'):format(
                    response.data.profile.firstName,
                    response.data.profile.lastName
                )
            ), { 120, 255, 160 })
        end
    )
end, false)

RegisterCommand('logout', function()
    exports.varde_core:CallAsync('session:logout', {}, function(response)
        if not response.ok then
            showError(response)
            return
        end
        message(locale('example.loggedOut', nil, 'Character logged out.'))
    end)
end, false)

RegisterCommand('whoami', function()
    local data = exports.varde_core:GetPlayerData()
    if not data then
        message(locale(
            'example.notLoggedIn',
            nil,
            'No character is logged in.'
        ))
        return
    end
    local job = locale(
        ('labels.jobs.%s.label'):format(data.job.name),
        nil,
        data.job.label or data.job.name
    )
    message(locale(
        'example.identity',
        {
            firstName = data.profile.firstName,
            lastName = data.profile.lastName,
            cash = data.money.cash or 0,
            bank = data.money.bank or 0,
            job = job
        },
        ('%s %s | cash: %s | bank: %s | job: %s'):format(
            data.profile.firstName,
            data.profile.lastName,
            data.money.cash or 0,
            data.money.bank or 0,
            job
        )
    ))
end, false)

RegisterNetEvent('varde_example:client:message', function(text, success)
    message(text, success and { 120, 255, 160 } or { 255, 100, 100 })
end)
local function locale(key, replacements, fallback)
    return exports.varde_core:Locale(key, replacements, fallback)
end
