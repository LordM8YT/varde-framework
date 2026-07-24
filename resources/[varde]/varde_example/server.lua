local function reply(source, text, success)
    if source == 0 then
        print(('[varde_example] %s'):format(text))
        return
    end
    TriggerClientEvent('varde_example:client:message', source, text, success)
end

RegisterCommand('grantcash', function(source, args)
    if source > 0 and not IsPlayerAceAllowed(source, 'varde.admin') then
        reply(source, locale(
            'example.adminRequired',
            nil,
            'You do not have varde.admin.'
        ), false)
        return
    end

    local target = tonumber(args[1])
    local amount = tonumber(args[2])
    if not target or not amount then
        reply(source, locale(
            'example.usageGrantCash',
            nil,
            'Usage: /grantcash <serverId> <amount>'
        ), false)
        return
    end

    local result = exports.varde_core:AddMoney(
        target,
        'cash',
        amount,
        'admin_grant',
        ('command:%s'):format(source)
    )

    if not result.ok then
        reply(source, ('%s: %s'):format(
            result.error.code,
            locale(
                ('errors.%s'):format(result.error.code),
                nil,
                result.error.message
            )
        ), false)
        return
    end

    reply(source, locale(
        'example.cashGranted',
        { amount = amount, source = target, balance = result.data },
        ('Granted %s cash to %s. New balance: %s.'):format(
            amount,
            target,
            result.data
        )
    ), true)
    reply(target, locale(
        'example.cashReceived',
        { amount = amount },
        ('You received %s cash.'):format(amount)
    ), true)
end, false)
local function locale(key, replacements, fallback)
    return exports.varde_core:Locale(key, replacements, fallback)
end
