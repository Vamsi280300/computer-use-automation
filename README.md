# Computer-Use Automation System

## Setup

## Demo path

## Mock App

`/mock-app` is a stand-in for a legacy internal bank servicing tool: a server-rendered
Express app with no JSON API, plain `<table>` layouts, generic class names and no
`data-*` or test hooks, so it has to be driven through the browser the way a real
legacy tool would be. It holds six invented members in memory (two of them `frozen`)
and covers the flow sign-on -> member search -> member detail -> open sub-account ->
confirmation. Four failure conditions can be triggered at runtime without editing the
app: an unknown member ID returns a clean "no member found" result, a frozen member
shows "action not permitted" in place of the sub-account form, `?simulateSlow=1` on
the results page delays the response 3 seconds, and `?simulateError=1` on the
sub-account POST returns a 500 page. Run it standalone with `npm run mock-app` and it
serves on http://localhost:4000 (override with `PORT`); sign on with any non-empty
operator ID and password.
