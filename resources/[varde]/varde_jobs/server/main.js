'use strict';

const { JobsDatabase } = require('./database');
const { JobsError } = require('./errors');
const { loadConfig } = require('./config');
const { JobsService } = require('./service');

const resourceName = GetCurrentResourceName();
const runtime = {
  resourcePath: GetResourcePath(resourceName),
  loadResourceFile(relativePath) {
    return LoadResourceFile(resourceName, relativePath);
  },
  emitClient(source, eventName, ...args) {
    emitNet(eventName, source, ...args);
  },
  log(level, message) {
    const output = `[varde_jobs] [${level}] ${message}`;
    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  },
};

const core = {
  getPlayerData(identifier) {
    return exports.varde_core.GetPlayerData(identifier);
  },
  getPlayerSource(characterId) {
    return exports.varde_core.GetPlayerSource(characterId);
  },
  setJob(identifier, job) {
    return exports.varde_core.SetJob(identifier, job);
  },
};

const config = loadConfig(runtime);
const database = new JobsDatabase(config.databaseFile);
const jobs = new JobsService(database, config, core, runtime);
const requestTimes = new Map();

function rateLimit(source, key, minimumIntervalMs) {
  const id = `${source}:${key}`;
  const now = Date.now();
  const previous = requestTimes.get(id) || 0;
  if (now - previous < minimumIntervalMs) {
    return false;
  }
  requestTimes.set(id, now);
  return true;
}

function result(work) {
  try {
    return { ok: true, data: work() };
  } catch (error) {
    if (error instanceof JobsError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message },
      };
    }
    runtime.log('error', error?.stack || String(error));
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'the jobs resource could not complete the operation',
      },
    };
  }
}

function notify(source, message, kind = 'info') {
  if (Number(source) > 0) {
    runtime.emitClient(
      Number(source),
      'varde_jobs:client:message',
      String(message),
      kind,
    );
  } else {
    runtime.log(kind === 'error' ? 'error' : 'info', String(message));
  }
}

function handle(source, work) {
  const response = result(work);
  if (!response.ok) {
    notify(source, response.error.message, 'error');
  }
  return response;
}

function actorForCommand(source) {
  return Number(source) === 0 ? 'console' : `source:${Number(source)}`;
}

function mayManage(source) {
  return Number(source) === 0 || IsPlayerAceAllowed(String(source), 'varde.jobs.manage');
}

on('varde:server:playerLoaded', (source) => {
  handle(source, () => jobs.sync(Number(source)));
});

on('varde:server:playerLoggedOut', (_source, characterId) => {
  handle(0, () => jobs.clearDuty(characterId, 'logout'));
});

on('varde:server:playerDropped', (_source, characterId) => {
  handle(0, () => jobs.clearDuty(characterId, 'disconnect'));
});

on('varde:server:characterDeleted', (_source, characterId) => {
  handle(0, () => jobs.deleteCharacter(characterId));
});

onNet('varde_jobs:server:request', () => {
  const source = Number(global.source);
  if (rateLimit(source, 'request', 500)) {
    handle(source, () => jobs.sync(source));
  }
});

onNet('varde_jobs:server:setActive', (jobName) => {
  const source = Number(global.source);
  if (rateLimit(source, 'active', 1000)) {
    handle(source, () => jobs.setActive(source, jobName));
  }
});

onNet('varde_jobs:server:clock', (jobName) => {
  const source = Number(global.source);
  if (rateLimit(source, 'duty', 1000)) {
    handle(source, () => {
      const ped = GetPlayerPed(String(source));
      const raw = ped ? GetEntityCoords(ped) : null;
      const coordinates = raw
        ? {
            x: Number(raw[0] ?? raw.x),
            y: Number(raw[1] ?? raw.y),
            z: Number(raw[2] ?? raw.z),
          }
        : null;
      return jobs.clockAtDutyPoint(
        source,
        jobName,
        coordinates,
        `source:${source}`,
      );
    });
  }
});

RegisterCommand(
  'assignjob',
  (source, args) => {
    if (!mayManage(source)) {
      notify(source, 'You do not have permission to manage jobs.', 'error');
      return;
    }
    const target = Number(args[0]);
    const jobName = args[1];
    const grade = args[2] ?? 0;
    const response = handle(source, () =>
      jobs.assign(target, jobName, grade, actorForCommand(source)),
    );
    if (response.ok) {
      notify(source, `Assigned ${jobName} grade ${grade} to source ${target}.`);
    }
  },
  false,
);

RegisterCommand(
  'removejob',
  (source, args) => {
    if (!mayManage(source)) {
      notify(source, 'You do not have permission to manage jobs.', 'error');
      return;
    }
    const target = Number(args[0]);
    const jobName = args[1];
    const response = handle(source, () =>
      jobs.remove(target, jobName, actorForCommand(source)),
    );
    if (response.ok) {
      notify(source, `Removed ${jobName} from source ${target}.`);
    }
  },
  false,
);

exports('GetJobs', (identifier) => {
  try {
    return jobs.getJobs(identifier);
  } catch {
    return [];
  }
});
exports('HasJob', (identifier, jobName, minimumGrade) =>
  jobs.hasJob(identifier, jobName, minimumGrade),
);
exports('HasPermission', (identifier, permission, options) =>
  jobs.hasPermission(identifier, permission, options),
);
exports('AssignJob', (identifier, jobName, grade) =>
  result(() =>
    jobs.assign(
      identifier,
      jobName,
      grade,
      GetInvokingResource() || 'resource',
    ),
  ),
);
exports('RemoveJob', (identifier, jobName) =>
  result(() =>
    jobs.remove(identifier, jobName, GetInvokingResource() || 'resource'),
  ),
);
exports('SetActiveJob', (identifier, jobName) =>
  result(() =>
    jobs.setActive(identifier, jobName, GetInvokingResource() || 'resource'),
  ),
);
exports('SetDuty', (identifier, onDuty) =>
  result(() =>
    jobs.setDuty(identifier, onDuty === true, GetInvokingResource() || 'resource'),
  ),
);

setTimeout(() => {
  for (const source of GetPlayers()) {
    const numericSource = Number(source);
    if (core.getPlayerData(numericSource)) {
      handle(numericSource, () => jobs.sync(numericSource));
    }
  }
}, 0);

on('playerDropped', () => {
  const source = Number(global.source);
  for (const key of requestTimes.keys()) {
    if (key.startsWith(`${source}:`)) {
      requestTimes.delete(key);
    }
  }
});

on('onResourceStop', (stoppedResource) => {
  if (stoppedResource === resourceName) {
    database.close();
  }
});

runtime.log(
  'info',
  `started with ${Object.keys(config.jobs).length} configured jobs`,
);
