# Vexel HTTP (2.2)

Real requests over a shared `HttpClient`. No custom protocol code.

```vxl
response = http get "https://example.com"

print response.status
print response.text
```

## Response object

- `status`: integer HTTP status (e.g. `200`).
- `text` / `body`: response body as a string.
- `headers`: object of lower-cased header names to values.

Read fields like any object: `response.headers["content-type"]`
works where index reads are supported, `response.status` anywhere.

## Errors

All failures are catchable Vexel errors naming the URL and reason:

```vxl
try {
    response = http get "https://example.com"
}
error {
    print error.message
}
```

- Bad URL → `HTTP Error: Invalid URL '...'.`
- DNS / connection failure → `HTTP Error: Could not reach '...' (reason).`
- Over 30s default timeout → `HTTP Error: Request to '...' timed out.`

The runtime never hangs indefinitely and never exposes raw .NET
traces for network faults.

## HTTP + tasks

Requests run anywhere, but belong on workers so the UI never waits:

```vxl
task fetch {
    response = http get "https://example.com"
    result = response.status
}
```

Cancellation flows into in-flight requests. See `docs/tasks.md`.

## Backend

HTTP needs `--avalonia`. Responses serialize cleanly to JSON.
