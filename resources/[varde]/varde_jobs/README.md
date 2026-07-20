# varde_jobs

`varde_jobs` owns persistent job assignments, grades, duty state, and resource
permissions. It uses the public `varde_core` API and keeps its data in a separate
SQLite database.

## Configuration

Edit `config/jobs.json` to define jobs and grades. Each grade has an explicit
permission list and payment value. Restart `varde_jobs` after changing the file.

By default, permission checks require the active job to be on duty. A server
resource can override that for a single check:

```js
const allowed = exports.varde_jobs.HasPermission(source, 'police.records.read', {
  requireDuty: false,
});
```

## Server exports

- `GetJobs(identifier)` returns every assignment.
- `HasJob(identifier, jobName, minimumGrade)` returns a boolean.
- `HasPermission(identifier, permission, options)` returns a boolean.
- `AssignJob(identifier, jobName, grade)` returns a result envelope.
- `RemoveJob(identifier, jobName)` returns a result envelope.
- `SetActiveJob(identifier, jobName)` returns a result envelope.
- `SetDuty(identifier, onDuty)` returns a result envelope.

An identifier can be an online server source or a Varde character ID. Mutating
exports currently require the character to be online so the core snapshot and
state bag are updated immediately after the jobs database.

## Commands and access

Players can use `/jobs`, `/job <name>`, and `/duty`.

Server admins can use `/assignjob <source> <job> <grade>` and
`/removejob <source> <job>`. Grant access with:

```cfg
add_ace group.admin varde.jobs.manage allow
```

Every assignment, removal, active-job change, and duty change is written to
`job_audit`.
