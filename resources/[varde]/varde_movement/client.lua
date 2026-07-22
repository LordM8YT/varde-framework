local RESOURCE_NAME = GetCurrentResourceName()

local INPUT_SPRINT = 21
local INPUT_JUMP = 22
local INPUT_MOVE_LR = 30
local INPUT_MOVE_UD = 31
local INPUT_DUCK = 36

local abs = math.abs
local max = math.max
local sqrt = math.sqrt

local function convarEnabled(name, defaultValue)
    local fallback = defaultValue and 'true' or 'false'
    local value = GetConvar(name, fallback):lower()
    return value ~= '0'
        and value ~= 'false'
        and value ~= 'off'
        and value ~= 'no'
end

local Config = {
    enabled = convarEnabled('varde_movement_enabled', true),
    requireVardeCharacter = true,

    -- Applied every active movement frame. Extreme values cause skating and
    -- network corrections, so the override intentionally remains conservative.
    moveRate = 1.08,
    sprintBlendRatio = 3.0,
    runBlendRatio = 2.0,
    walkBlendRatio = 1.0,
    turnBlendOutAngle = 42.0,
    turnBlendOutCooldownMs = 80,

    slideDurationMs = 650,
    slideCooldownMs = 1500,
    slideMinimumSpeed = 5.0,
    slideStopSpeed = 2.0,
    slideInitialForce = 5.75,
    slideSustainForce = 0.30,
    slideSustainMs = 110,
    slideClipset = 'move_ped_crouched',

    vaultMinimumSpeed = 4.8,
    vaultPrimeMs = 900,
    vaultInitialForce = 0.75,
    vaultExitForce = 1.15,
    vaultMoveRate = 1.15
}

local characterLoaded = not Config.requireVardeCharacter
local currentPed = 0
local lastMoveHeading = nil
local lastBlendOutAt = 0

local slideActive = false
local slideEndsAt = 0
local slideSustainUntil = 0
local slideCooldownUntil = 0
local slideHeading = 0.0

local vaultPrimedUntil = 0
local vaultActive = false
local vaultMomentum = 0.0

local movementClipsetRequested = false
local movementClipsetReady = false
local originalPedState = {}

local function nativeTrue(value)
    -- Enhanced early access can expose native BOOL values as true/false or 1/0.
    return value == true or value == 1
end

local function angleDifference(first, second)
    return ((first - second + 180.0) % 360.0) - 180.0
end

local function cameraHeading()
    return GetGameplayCamRot(2).z
end

local function applyForwardForce(ped, amount, verticalForce)
    local forward = GetEntityForwardVector(ped)
    ApplyForceToEntity(
        ped,
        1,
        forward.x * amount,
        forward.y * amount,
        verticalForce or 0.0,
        0.0,
        0.0,
        0.0,
        0,
        false,
        false,
        false,
        false,
        true
    )
end

local function horizontalSpeed(ped)
    local velocity = GetEntityVelocity(ped)
    return sqrt((velocity.x * velocity.x) + (velocity.y * velocity.y))
end

local function requestMovementClipset()
    if movementClipsetRequested then
        return
    end

    movementClipsetRequested = true
    RequestAnimSet(Config.slideClipset)
end

local function refreshMovementClipset()
    if movementClipsetRequested and not movementClipsetReady then
        movementClipsetReady = nativeTrue(HasAnimSetLoaded(Config.slideClipset))
    end
end

local function configurePed(ped)
    if originalPedState[ped] == nil then
        originalPedState[ped] = {
            canRagdoll = nativeTrue(CanPedRagdoll(ped)),
            flags = {
                [102] = nativeTrue(GetPedConfigFlag(ped, 102, true)),
                [103] = nativeTrue(GetPedConfigFlag(ped, 103, true)),
                [128] = nativeTrue(GetPedConfigFlag(ped, 128, true)),
                [226] = nativeTrue(GetPedConfigFlag(ped, 226, true)),
                [241] = nativeTrue(GetPedConfigFlag(ped, 241, true)),
                [427] = nativeTrue(GetPedConfigFlag(ped, 427, true))
            }
        }
    end

    -- 128 = CanBeAgitated. Disable ambient agitation on the local player.
    SetPedConfigFlag(ped, 128, false)

    -- 241 = LeaveEngineOnWhenExitingVehicles. Some movement snippets incorrectly
    -- treat it as an inertia flag, so keep the value owned by the server instead.
    SetPedConfigFlag(ped, 241, originalPedState[ped].flags[241])

    -- 427 = IgnoreInteriorCheckForSprinting. Keep sprint input consistent inside.
    SetPedConfigFlag(ped, 427, true)

    -- Remove GTA's automatic steering around nearby peds and objects.
    SetPedConfigFlag(ped, 102, false)
    SetPedConfigFlag(ped, 103, false)
    SetPedConfigFlag(ped, 226, true)

    SetPedPathCanUseClimbovers(ped, true)
    SetPedPathCanUseLadders(ped, true)
    SetPedMaxMoveBlendRatio(ped, Config.sprintBlendRatio)
    SetPedMinMoveBlendRatio(ped, 0.0)
    SetPedUsingActionMode(ped, false, -1, 'DEFAULT_ACTION')

    requestMovementClipset()
end

local function restorePed(ped)
    if ped == 0 or not nativeTrue(DoesEntityExist(ped)) then
        originalPedState[ped] = nil
        return
    end

    local savedState = originalPedState[ped]
    if savedState == nil then
        return
    end

    ResetPedMovementClipset(ped, 0.20)
    ResetPedStrafeClipset(ped)
    SetPedCanRagdoll(ped, savedState.canRagdoll)

    -- Restore the exact values observed before Varde touched this ped.
    for flag, value in pairs(savedState.flags) do
        SetPedConfigFlag(ped, flag, value)
    end
    originalPedState[ped] = nil
end

local function finishSlide(ped)
    if not slideActive then
        return
    end

    slideActive = false
    slideEndsAt = 0
    slideSustainUntil = 0

    if ped ~= 0 and nativeTrue(DoesEntityExist(ped)) then
        local savedState = originalPedState[ped]
        ResetPedMovementClipset(ped, 0.16)
        ResetPedStrafeClipset(ped)
        SetPedCanRagdoll(
            ped,
            savedState == nil or savedState.canRagdoll
        )
    end
end

local function startSlide(ped, now, heading)
    if not movementClipsetReady or now < slideCooldownUntil then
        return false
    end

    slideActive = true
    slideEndsAt = now + Config.slideDurationMs
    slideSustainUntil = now + Config.slideSustainMs
    slideCooldownUntil = now + Config.slideCooldownMs
    slideHeading = heading

    SetEntityHeading(ped, slideHeading)
    SetPedMoveAnimsBlendOut(ped)
    SetPedMovementClipset(ped, Config.slideClipset, 0.05)
    SetPedCanRagdoll(ped, false)
    applyForwardForce(ped, Config.slideInitialForce, -0.05)
    return true
end

local function canUseResponsiveMovement(ped)
    return not nativeTrue(IsEntityInAir(ped))
        and not nativeTrue(IsPedRagdoll(ped))
        and not nativeTrue(IsPedFalling(ped))
        and not nativeTrue(IsPedJumping(ped))
        and not nativeTrue(IsPedVaulting(ped))
        and not nativeTrue(IsPedClimbing(ped))
        and not nativeTrue(IsPedGettingUp(ped))
        and not nativeTrue(IsPedBeingStunned(ped, 0))
        and not nativeTrue(IsPedInCover(ped, false))
end

local function isUsableOnFootPed(ped)
    return ped ~= 0
        and nativeTrue(DoesEntityExist(ped))
        and nativeTrue(IsPedOnFoot(ped))
        and not nativeTrue(IsPedInAnyVehicle(ped, false))
        and not nativeTrue(IsEntityDead(ped))
        and not nativeTrue(IsPedSwimming(ped))
        and not nativeTrue(IsPedSwimmingUnderWater(ped))
end

local function clearTransientMovement(ped)
    if slideActive then
        finishSlide(ped)
    end

    vaultPrimedUntil = 0
    vaultActive = false
    vaultMomentum = 0.0
    lastMoveHeading = nil
end

local function refreshCharacterLoaded()
    if not Config.requireVardeCharacter then
        characterLoaded = true
        return
    end

    local playerState = LocalPlayer and LocalPlayer.state
    characterLoaded = playerState ~= nil
        and nativeTrue(playerState['varde:loaded'])
end

RegisterNetEvent('varde:client:playerLoaded', function()
    characterLoaded = true
end)

RegisterNetEvent('varde:client:playerLoggedOut', function()
    characterLoaded = not Config.requireVardeCharacter
    if currentPed ~= 0 then
        clearTransientMovement(currentPed)
        restorePed(currentPed)
        currentPed = 0
    end
end)

CreateThread(function()
    if not Config.enabled then
        return
    end

    refreshCharacterLoaded()

    while true do
        local sleep = 500

        if characterLoaded and nativeTrue(NetworkIsPlayerActive(PlayerId())) then
            local ped = PlayerPedId()

            if ped ~= currentPed then
                if currentPed ~= 0 then
                    clearTransientMovement(currentPed)
                    restorePed(currentPed)
                end
                currentPed = ped
                if currentPed ~= 0
                    and nativeTrue(DoesEntityExist(currentPed)) then
                    configurePed(currentPed)
                end
            end

            if isUsableOnFootPed(ped) and not nativeTrue(IsPauseMenuActive()) then
                -- Per-frame polling exists only while a loaded character is on foot.
                sleep = 0
                refreshMovementClipset()

                local now = GetGameTimer()
                local moveLeftRight = GetControlNormal(0, INPUT_MOVE_LR)
                local moveUpDown = GetControlNormal(0, INPUT_MOVE_UD)
                local moving = abs(moveLeftRight) > 0.08
                    or abs(moveUpDown) > 0.08
                local movingForward = moveUpDown < -0.20

                local needsSpeed = moving
                    or slideActive
                    or vaultActive
                    or now <= vaultPrimedUntil
                local speed = needsSpeed and GetEntitySpeed(ped) or 0.0
                local sprintHeld = nativeTrue(IsControlPressed(0, INPUT_SPRINT))
                local sprinting = movingForward
                    and (nativeTrue(IsPedSprinting(ped))
                        or (sprintHeld and speed >= 3.7))

                local vaulting = nativeTrue(IsPedVaulting(ped))
                local climbing = nativeTrue(IsPedClimbing(ped))
                local inAir = nativeTrue(IsEntityInAir(ped))
                local ragdolling = nativeTrue(IsPedRagdoll(ped))

                if slideActive then
                    DisableControlAction(0, INPUT_DUCK, true)
                    SetEntityHeading(ped, slideHeading)
                    SetPedMoveRateOverride(ped, Config.vaultMoveRate)

                    if now <= slideSustainUntil then
                        applyForwardForce(ped, Config.slideSustainForce, 0.0)
                    end

                    if now >= slideEndsAt
                        or speed <= Config.slideStopSpeed
                        or inAir
                        or ragdolling
                        or vaulting
                        or climbing then
                        finishSlide(ped)
                    end
                elseif moving
                    and sprinting
                    and speed >= Config.slideMinimumSpeed
                    and not inAir
                    and not ragdolling
                    and not vaulting
                    and not climbing
                    and nativeTrue(IsControlJustPressed(0, INPUT_DUCK)) then
                    startSlide(ped, now, cameraHeading())
                end

                if not slideActive
                    and movingForward
                    and sprinting
                    and speed >= Config.vaultMinimumSpeed
                    and not inAir
                    and nativeTrue(IsControlJustPressed(0, INPUT_JUMP)) then
                    vaultPrimedUntil = now + Config.vaultPrimeMs
                    vaultMomentum = max(speed, horizontalSpeed(ped))
                end

                if vaulting and now <= vaultPrimedUntil then
                    if not vaultActive then
                        vaultActive = true
                        applyForwardForce(ped, Config.vaultInitialForce, 0.10)
                    end

                    SetPedMoveRateOverride(ped, Config.vaultMoveRate)
                    SetPedDesiredMoveBlendRatio(ped, Config.sprintBlendRatio)
                elseif vaultActive and not vaulting then
                    local missingSpeed = max(0.0, vaultMomentum - horizontalSpeed(ped))
                    applyForwardForce(
                        ped,
                        Config.vaultExitForce + (missingSpeed * 0.20),
                        0.02
                    )
                    vaultActive = false
                    vaultPrimedUntil = 0
                    vaultMomentum = 0.0
                elseif now > vaultPrimedUntil and not vaultActive then
                    vaultPrimedUntil = 0
                    vaultMomentum = 0.0
                end

                if moving and not slideActive and canUseResponsiveMovement(ped) then
                    local heading = cameraHeading()
                    if lastMoveHeading ~= nil
                        and abs(angleDifference(heading, lastMoveHeading))
                            >= Config.turnBlendOutAngle
                        and now - lastBlendOutAt
                            >= Config.turnBlendOutCooldownMs then
                        SetPedMoveAnimsBlendOut(ped)
                        lastBlendOutAt = now
                    end

                    SetEntityHeading(ped, heading)
                    SetPedMoveRateOverride(ped, Config.moveRate)

                    if sprinting then
                        SetPedDesiredMoveBlendRatio(ped, Config.sprintBlendRatio)
                    elseif speed >= 2.0 then
                        SetPedDesiredMoveBlendRatio(ped, Config.runBlendRatio)
                    else
                        SetPedDesiredMoveBlendRatio(ped, Config.walkBlendRatio)
                    end

                    lastMoveHeading = heading
                elseif not moving then
                    lastMoveHeading = nil
                end

            else
                clearTransientMovement(ped)
            end
        else
            if currentPed ~= 0 then
                clearTransientMovement(currentPed)
                restorePed(currentPed)
                currentPed = 0
            end
            refreshCharacterLoaded()
        end

        Wait(sleep)
    end
end)

AddEventHandler('onResourceStop', function(stoppedResource)
    if stoppedResource ~= RESOURCE_NAME then
        return
    end

    restorePed(currentPed)

    if movementClipsetRequested then
        RemoveAnimSet(Config.slideClipset)
    end
end)
