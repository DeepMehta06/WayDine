# WayDine working instructions

- The user is on Google Places' free allowance. Before making **any live Google
  Places API request**, obtain the user's explicit approval for that request or
  a clearly stated bounded batch. A configured key is not permission to test it.
- Use mocked Google responses for automated tests. Never run live smoke tests,
  photo downloads, or Google-backed recommendation requests automatically.
- Keep backend and database work first. Do not redesign or build frontend screens
  unless the user requests them.
