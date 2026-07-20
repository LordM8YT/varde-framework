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
        error.message or 'unknown error'
    ), { 255, 100, 100 })
end

RegisterCommand('characters', function()
    exports.varde_core:CallAsync('characters:list', {}, function(response)
        if not response.ok then
            showError(response)
            return
        end

        if #response.data == 0 then
            message('No characters. Use /newchar <slot> <first> <last> <YYYY-MM-DD>.')
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
        message('Usage: /newchar <slot> <first> <last> <YYYY-MM-DD>')
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
        message(('Created %s %s with id %s. Use /playchar %s.'):format(
            response.data.profile.firstName,
            response.data.profile.lastName,
            response.data.characterId,
            response.data.characterId
        ), { 120, 255, 160 })
    end)
end, false)

RegisterCommand('playchar', function(_, args)
    if not args[1] then
        message('Usage: /playchar <characterId>')
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
            message(('Logged in as %s %s.'):format(
                response.data.profile.firstName,
                response.data.profile.lastName
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
        message('Character logged out.')
    end)
end, false)

RegisterCommand('whoami', function()
    local data = exports.varde_core:GetPlayerData()
    if not data then
        message('No character is logged in.')
        return
    end
    message(('%s %s | cash: %s | bank: %s | job: %s'):format(
        data.profile.firstName,
        data.profile.lastName,
        data.money.cash or 0,
        data.money.bank or 0,
        data.job.label or data.job.name
    ))
end, false)

RegisterNetEvent('varde_example:client:message', function(text, success)
    message(text, success and { 120, 255, 160 } or { 255, 100, 100 })
end)
