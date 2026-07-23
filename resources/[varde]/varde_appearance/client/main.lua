local appearance = nil
local hasSpawned = false
local applying = false

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
    print(('[varde_appearance] %s'):format(tostring(text)))
end

local function loadModel(model)
    local hash = GetHashKey(model)
    if not nativeTrue(IsModelInCdimage(hash))
        or not nativeTrue(IsModelValid(hash)) then
        return nil
    end
    RequestModel(hash)
    local deadline = GetGameTimer() + 10000
    while not nativeTrue(HasModelLoaded(hash)) and GetGameTimer() < deadline do
        Wait(25)
    end
    if not nativeTrue(HasModelLoaded(hash)) then
        return nil
    end
    return hash
end

local function apply(value)
    if applying or type(value) ~= 'table' or type(value.model) ~= 'string' then
        return false
    end
    applying = true

    local hash = loadModel(value.model)
    if not hash then
        applying = false
        message('The stored character model could not be loaded.', 'error')
        return false
    end

    if GetEntityModel(PlayerPedId()) ~= hash then
        SetPlayerModel(PlayerId(), hash)
    end
    SetModelAsNoLongerNeeded(hash)

    local ped = PlayerPedId()
    SetPedDefaultComponentVariation(ped)
    ClearAllPedProps(ped)

    local blend = value.headBlend
    if type(blend) == 'table' then
        SetPedHeadBlendData(
            ped,
            tonumber(blend.shapeFirst) or 0,
            tonumber(blend.shapeSecond) or 0,
            tonumber(blend.shapeThird) or 0,
            tonumber(blend.skinFirst) or 0,
            tonumber(blend.skinSecond) or 0,
            tonumber(blend.skinThird) or 0,
            tonumber(blend.shapeMix) or 0.5,
            tonumber(blend.skinMix) or 0.5,
            tonumber(blend.thirdMix) or 0.0,
            false
        )
    end

    for _, feature in ipairs(value.faceFeatures or {}) do
        SetPedFaceFeature(
            ped,
            tonumber(feature.index),
            tonumber(feature.value)
        )
    end

    SetPedHairColor(
        ped,
        tonumber(value.hairColor) or 0,
        tonumber(value.hairHighlight) or 0
    )
    SetPedEyeColor(ped, tonumber(value.eyeColor) or 0)

    for _, overlay in ipairs(value.headOverlays or {}) do
        SetPedHeadOverlay(
            ped,
            tonumber(overlay.overlayId),
            tonumber(overlay.value),
            tonumber(overlay.opacity)
        )
        SetPedHeadOverlayColor(
            ped,
            tonumber(overlay.overlayId),
            tonumber(overlay.colorType),
            tonumber(overlay.color),
            tonumber(overlay.secondaryColor)
        )
    end

    for _, component in ipairs(value.components or {}) do
        SetPedComponentVariation(
            ped,
            tonumber(component.componentId),
            tonumber(component.drawable),
            tonumber(component.texture),
            tonumber(component.palette)
        )
    end

    for _, prop in ipairs(value.props or {}) do
        if tonumber(prop.drawable) and tonumber(prop.drawable) >= 0 then
            SetPedPropIndex(
                ped,
                tonumber(prop.propId),
                tonumber(prop.drawable),
                tonumber(prop.texture),
                true
            )
        else
            ClearPedProp(ped, tonumber(prop.propId))
        end
    end

    applying = false
    TriggerEvent('varde_appearance:client:applied', copy(value))
    return true
end

RegisterNetEvent('varde_appearance:client:update', function(value)
    appearance = copy(value)
    TriggerEvent('varde_appearance:client:updated', copy(value))
    if hasSpawned then
        CreateThread(function()
            apply(appearance)
        end)
    end
end)

RegisterNetEvent('varde_appearance:client:error', function(text)
    message(text, 'error')
end)

RegisterNetEvent('varde:client:playerLoaded', function()
    hasSpawned = false
    TriggerServerEvent('varde_appearance:server:request')
end)

RegisterNetEvent('varde:client:playerLoggedOut', function()
    hasSpawned = false
    appearance = nil
end)

AddEventHandler('playerSpawned', function()
    hasSpawned = true
    CreateThread(function()
        Wait(100)
        if appearance then
            apply(appearance)
        else
            TriggerServerEvent('varde_appearance:server:request')
        end
    end)
end)

RegisterCommand('appearance', function()
    if not appearance then
        message('No character appearance is loaded.', 'error')
        return
    end
    TriggerEvent('varde_appearance:client:openRequested', copy(appearance))
    message('Appearance editor hook opened. No editor UI is installed yet.')
end, false)

RegisterCommand('resetappearance', function()
    TriggerServerEvent('varde_appearance:server:reset')
end, false)

exports('GetAppearance', function()
    return copy(appearance)
end)

exports('ApplyAppearance', function(value)
    return apply(value)
end)

exports('SaveAppearance', function(value)
    TriggerServerEvent('varde_appearance:server:save', value)
    return true
end)

exports('ResetAppearance', function()
    TriggerServerEvent('varde_appearance:server:reset')
    return true
end)

CreateThread(function()
    while not nativeTrue(NetworkIsPlayerActive(PlayerId())) do
        Wait(250)
    end
    if GetResourceState('varde_core') == 'started'
        and exports.varde_core:IsLoggedIn() then
        hasSpawned = nativeTrue(DoesEntityExist(PlayerPedId()))
        TriggerServerEvent('varde_appearance:server:request')
    end
end)
