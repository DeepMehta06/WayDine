# WayDine — Route-Based Restaurant Discovery and Intelligent Food Recommendations

## 1. Project Objective

Upgrade the existing WayDine application into a functional route-based restaurant discovery and food recommendation platform.

The application should help users find suitable restaurants along their planned driving route, minimize unnecessary detours, account for driving direction and highway accessibility, and recommend food based on estimated arrival time, restaurant operating hours, food availability, and user preferences.

**Important:** This is an enhancement to an existing project, not a request to rebuild the application from scratch.

Before making any changes:
1. Inspect the entire existing codebase.
2. Identify the frontend framework, backend, routing implementation, database, existing API integrations, and current UI structure.
3. Identify which features are already functional and which are missing.
4. Reuse existing components, utilities, API clients, styling, and working functionality wherever possible.
5. Create a phased implementation plan based on the actual codebase.
6. Then implement the changes in logical stages.

Do not stop after producing a plan. Implement the functionality, run the available tests, and fix errors where possible.

---

## 2. Existing Technology and API Constraints

The application has a Google Places API key available.

First, inspect the existing configuration to determine which services are actually implemented and available.

Potential integrations:
- Google Places API for restaurant discovery and supported place details.
- Google Maps JavaScript API if already used for map rendering.
- Google Routes API for driving directions and route calculations, if enabled.
- Mapbox for routing if the project already uses it and Google Routes is unavailable.
- Geoapify if already integrated and useful for restaurant discovery.
- PostgreSQL/Supabase or the project's existing database for restaurant records, menus, operating hours, and user preferences.

Do not replace existing providers without a clear technical reason.

Do not assume that a Google Places API key automatically grants access to Google Routes API or every Maps Platform service.

Inspect environment variables and configuration files to determine which integrations exist. Never print secret API keys or commit them to source control.

If an API is unavailable, implement a clean provider abstraction and document the missing configuration instead of fabricating successful API responses.

Do not introduce AI/ML, paid services unnecessarily, or unrelated features.

---

# TASK A — Route-Based Restaurant Recommendations

## A1. Route acquisition

Allow users to select:
- Starting location.
- Destination.
- Driving route, using the existing routing implementation.

Obtain the route geometry as an ordered sequence of geographic coordinates.

Preserve the original route's distance, duration, and geometry.

When either endpoint changes, recalculate the route and update restaurant discovery.

## A2. Restaurant discovery along the route

Discover restaurants located within a configurable 200-metre corridor around the planned route.

Requirements:
- Sample points along the route at appropriate intervals.
- Search for nearby restaurants using the configured Places provider.
- Account for the search radius and API limitations.
- Deduplicate restaurants discovered from overlapping searches.
- Preserve restaurant IDs, names, coordinates, ratings, opening hours, and other supported fields when available.
- Handle pagination and provider-specific result limits.
- Cache appropriate responses where permitted by provider policies.
- Avoid excessive API requests and unnecessary costs.

The 200-metre requirement refers to the restaurant's geographic proximity to the route geometry, not its driving distance from the nearest road.

Calculate the minimum geographic distance from each restaurant to the route polyline. Exclude restaurants outside the required corridor.

Do not assume that a restaurant within 200 metres of the route is necessarily accessible from the highway.

## A3. Detour calculation

For each candidate restaurant, calculate the additional driving time and distance required to visit it.

Use actual road-network routing rather than straight-line distance.

Conceptually:

detourDuration =
    duration(origin -> restaurant)
    + duration(restaurant -> destination)
    - duration(origin -> destination)

Use the routing provider's actual results for these calculations.

Where appropriate, use a route matrix to evaluate multiple candidates efficiently, followed by route validation for promising stops.

Support a configurable maximum detour duration.

Reject candidates that exceed the limit.

Account for:
- Original route duration.
- Additional driving time.
- Additional driving distance.
- Restaurant position relative to progress along the route.
- Significant backward travel.
- Routes requiring unnecessary diversions.

Do not classify a restaurant as a bad stop based only on its straight-line distance.

## A4. Graph traversal and shortest-path algorithms

The project requirements explicitly mention graph traversal and shortest-path algorithms.

Implement and document a genuine graph-based component rather than merely claiming that an external routing API satisfies this requirement.

First inspect the existing project and identify the most appropriate implementation.

Where suitable road-network graph data is available:
- Represent relevant road intersections or road segments as graph vertices and edges.
- Model edges as directed where the road network provides directionality.
- Assign edge weights based on travel time or distance.
- Implement Dijkstra's algorithm for non-negative edge weights.
- Use graph traversal to explore relevant road-network candidates.
- Compare candidate routes and select practical restaurant stops.
- Account for directionality and avoid invalid transitions.

If a complete road graph is unavailable, do not fabricate one or pretend that restaurant coordinates form a road graph.

Instead, implement a clearly defined graph-based candidate-selection or route-progression component, use the routing provider to validate real driving paths, and document any limitations.

Keep the graph algorithm separate from the external routing provider so that the implementation is testable.

## A5. Recommendation output

Each restaurant result should contain, when available:
- Restaurant ID.
- Name.
- Geographic coordinates.
- Distance from route.
- Original route distance and duration.
- Additional driving distance.
- Additional driving duration.
- Estimated arrival time.
- Opening status at arrival.
- Direction/accessibility assessment.
- Recommendation status and reason.

Display useful explanations such as:
- Low detour.
- Close to the planned route.
- Requires substantial backward travel.
- Accessibility uncertain.
- Closed at estimated arrival.

Do not present estimated or uncertain information as verified facts.

---

# TASK B — Direction and Road-Side Filtering

## B1. Determine travel direction

Use the ordered route coordinates to estimate the vehicle's direction of travel at relevant positions.

Implement a utility that:
- Finds the nearest relevant segment of the route polyline.
- Determines the segment's direction of travel.
- Calculates the bearing of the route segment.
- Determines the restaurant's approximate position relative to that directed segment.

Use geographic calculations that account for longitude and latitude rather than treating geographic coordinates as ordinary Cartesian coordinates over large distances.

Handle curved roads and route bends by using the local segment near the restaurant's projected position.

Do not calculate the travel direction using only the origin and destination when the route contains multiple bends.

## B2. Road-side estimation

Estimate whether a restaurant lies to the left or right of the vehicle's direction of travel relative to the local route segment.

Clearly distinguish:
- Left of route.
- Right of route.
- Near the route centreline.
- Side uncertain.

A restaurant's geographic side relative to a polyline is not proof that it is accessible from that side of the road.

Use available road-network information to assess actual accessibility.

If the provider does not expose sufficient road-side, access, median, or entrance information, mark accessibility as uncertain instead of claiming certainty.

## B3. U-turn and crossing avoidance

For each candidate:
- Calculate a real driving route from the user's current route context to the restaurant.
- Validate the onward route from the restaurant back toward the destination.
- Detect substantial backward travel where possible.
- Identify route reversals or significant directional deviations.
- Prefer stops that preserve forward progress and require less additional driving.
- Flag potential U-turns or highway-crossing requirements when supported by route geometry or road-network data.

Do not assume that every left-side restaurant requires a U-turn or that every right-side restaurant is accessible without crossing traffic.

Avoid rejecting legitimate stops solely because they are on the opposite geometric side when a safe, practical access route exists.

## B4. Direction-aware ranking

Incorporate direction and accessibility into the recommendation logic.

Suggested priority:
1. Valid driving access.
2. No excessive detour.
3. Minimal backward travel.
4. Fewer unnecessary route deviations.
5. Preferred road-side access when reliable information is available.

Allow uncertain accessibility to be displayed and handled separately from confirmed inaccessibility.

---

# TASK C — Time-Based Food Recommendations

## C1. Estimated arrival time

Calculate the estimated arrival time for each candidate restaurant.

Use:
- Current time.
- Route travel duration.
- Additional driving time required to reach the restaurant.

If reliable live traffic information is available, use it through the configured routing provider. Otherwise, use the provider's available duration estimate and clearly treat it as an estimate.

Recalculate arrival times when the route, destination, or candidate restaurant changes.

Use the correct local timezone for the route location. For an initial India-focused implementation, support Asia/Kolkata.

## C2. Meal-time rules

Implement deterministic, configurable meal-time rules.

Suggested defaults:
- Breakfast: 05:00–11:00.
- Lunch: 11:00–16:00.
- Snacks: 16:00–19:00.
- Dinner: 19:00–23:00.
- Late night: 23:00–05:00.

Make these boundaries configurable.

Meal-time rules should influence which available food options are prioritized. Do not assume that a restaurant serves breakfast, lunch, or dinner merely because the current time falls within that period.

When actual menu categories are available, use them. Otherwise, label the recommendation as time-based rather than claiming verified meal availability.

## C3. Restaurant opening hours

Use the most reliable available source for restaurant opening hours.

Requirements:
- Determine whether the restaurant is expected to be open at its estimated arrival time.
- Support operating hours that cross midnight.
- Account for the correct day of the week and timezone.
- Exclude restaurants confirmed to be closed at arrival when the application requires an open restaurant.
- Treat missing or ambiguous opening hours as unknown.
- Never interpret missing hours as proof that a restaurant is open.

If the restaurant has a supported live open-status field, use it appropriately, while recognizing that current open status does not necessarily guarantee opening at a future arrival time.

## C4. Menu and food availability

Create or extend the existing database to store menu items.

Each menu item should support:
- Unique ID.
- Restaurant ID.
- Dish name.
- Description.
- Price.
- Category.
- Vegetarian classification.
- Availability status.
- Optional image reference.
- Data source.
- Last verification timestamp.

Support restaurant-level operating hours and item-level availability separately.

Do not assume that Google Places provides complete restaurant menus or itemized prices.

Use an available menu integration where properly authorized. Otherwise, use curated, clearly identified prototype data.

Do not fabricate real-world restaurant menus, prices, opening hours, ratings, or availability.

If menu data is missing, display an explicit unavailable state.

## C5. User preferences

Use the project's existing database and authentication implementation if available.

Support preferences such as:
- Dietary requirements.
- Preferred cuisines.
- Maximum food budget.
- Preferred meal types.
- Maximum acceptable detour.
- Minimum preferred rating, where available.

Apply preferences as deterministic filters.

Distinguish between confirmed matches, confirmed mismatches, and unknown data.

For example, a missing vegetarian classification must not automatically be interpreted as vegetarian.

Do not introduce authentication or a new database provider if the project already has a suitable implementation.

## C6. Ranking logic

Build a transparent recommendation engine.

Apply hard constraints first:
- Within the route corridor.
- Within the maximum detour limit.
- Valid driving route.
- Meets mandatory dietary requirements when reliably known.
- Satisfies required opening-status conditions.

Then rank eligible candidates using configurable factors:
- Additional driving time.
- Backward travel.
- Road-side accessibility.
- Meal suitability.
- Menu availability.
- Budget match.
- Rating, when available.
- Cuisine preference.

Normalize scores where necessary and document the ranking formula.

Avoid allowing a high rating to outweigh a mandatory safety or route constraint.

The ranking must be deterministic for the same inputs.

Provide an explanation for each recommendation.

---

# 3. Frontend and UI Requirements

Preserve WayDine's existing design system, layout, components, and visual identity.

Do not replace the current interface with a generic template.

Extend the existing screens to support the complete user journey:

### Route planner
- Source and destination search.
- Route display.
- Distance and estimated duration.
- Loading and error states.

### Restaurant discovery
- Restaurant markers on the map.
- Restaurant cards.
- Route-distance and detour information.
- Opening status and available place details.
- Sorting and filtering controls.

### Restaurant details
- Available restaurant information.
- Menu categories and items when available.
- Prices and dietary labels.
- Estimated arrival time.
- Operating hours.
- Accessibility and detour explanation.

### Recommendation controls
- Maximum detour.
- Budget.
- Dietary preferences.
- Cuisine preferences.
- Meal-time suitability.

### Visual behavior
- Update results when the route changes.
- Keep map markers and restaurant cards synchronized.
- Selecting a card should highlight the corresponding marker.
- Handle empty results gracefully.
- Clearly label missing, estimated, and uncertain information.
- Keep the UI responsive and accessible.

Do not add excessive animations or decorative components at the expense of usability.

---

# 4. Backend and API Design

Follow the architecture already present in the repository.

If a backend exists, extend it.

If the application currently calls external APIs directly from the frontend, assess whether the integration requires a backend to protect credentials and centralize business logic.

Separate:
- Places discovery.
- Route calculation.
- Route-corridor filtering.
- Detour calculation.
- Graph algorithms.
- Direction estimation.
- Menu queries.
- Operating-hour checks.
- User preference filtering.
- Recommendation ranking.

Use appropriate modules and interfaces rather than placing all logic in a single component.

Create or update API endpoints only as needed by the existing architecture.

Possible endpoint responsibilities include:
- Calculate or retrieve a route.
- Discover restaurants along a route.
- Calculate candidate detours.
- Retrieve restaurant and menu details.
- Apply user preferences.
- Return ranked recommendations.

Validate request parameters and handle API failures, timeouts, rate limits, and missing data.

Never expose server-side API secrets to the browser.

Restrict browser API keys to authorized websites and permitted APIs.

Do not log credentials.

---

# 5. Testing Requirements

Implement tests for the core business logic.

At minimum, test:

### Route-based discovery
- Restaurant within 200 metres.
- Restaurant outside 200 metres.
- Duplicate restaurant results.
- Empty discovery results.
- Route changes.

### Detour calculation
- Restaurant requiring a small detour.
- Restaurant requiring a large detour.
- Restaurant requiring substantial backward travel.
- Unreachable restaurant.
- Missing route-duration data.

### Direction estimation
- Restaurant left of a directed route segment.
- Restaurant right of a directed route segment.
- Curved route.
- Restaurant close to the route centreline.
- Ambiguous or insufficient geometry.

### Time-based filtering
- Breakfast, lunch, snacks, dinner, and late-night boundaries.
- Arrival on the next day.
- Overnight operating hours.
- Restaurant closed at arrival.
- Missing operating hours.
- Unavailable menu item.

### User preferences
- Budget match and mismatch.
- Dietary match and mismatch.
- Missing dietary data.
- Cuisine match.
- No candidates satisfying mandatory constraints.

Use mocked API responses for automated tests. Do not consume paid API requests unnecessarily during test runs.

Add a small manual verification procedure for testing against real APIs.

---

# 6. Implementation Order

Implement the project in these stages:

**Stage 1 — Audit and Foundation**
- Inspect the existing code.
- Identify functional components and missing features.
- Verify available API integrations and configuration.
- Preserve existing UI and architecture.
- Establish reusable route and restaurant data models.

**Stage 2 — Route-Based Restaurant Discovery**
- Retrieve route geometry.
- Search along the route.
- Enforce the 200-metre corridor.
- Deduplicate restaurant results.
- Display restaurant markers and cards.

**Stage 3 — Detour and Direction Engine**
- Calculate actual driving detours.
- Implement the graph-based algorithm component.
- Estimate direction and road-side position.
- Flag backward travel and uncertain access.
- Filter and rank practical stops.

**Stage 4 — Database and Food Recommendations**
- Add or extend menu and operating-hours data.
- Integrate user preferences.
- Calculate arrival times.
- Apply meal-time, dietary, availability, and budget rules.

**Stage 5 — Integration and Validation**
- Connect all components.
- Polish existing UI.
- Add loading, error, and empty states.
- Run automated tests and available lint/type checks.
- Fix regressions.
- Document API configuration, data limitations, and setup instructions.

Adapt these stages to the actual codebase. If a stage is already implemented correctly, verify it and move forward rather than rebuilding it.

---

# 7. Engineering Constraints

- Reuse existing dependencies where practical.
- Avoid unnecessary libraries.
- Do not introduce AI/ML.
- Do not create duplicate components or API clients.
- Do not hardcode API keys.
- Do not commit secrets.
- Do not use fake API responses as production functionality.
- Do not fabricate road-accessibility or menu information.
- Do not replace working functionality without justification.
- Avoid breaking existing routes, pages, or styling.
- Keep functions modular and testable.
- Use meaningful types and interfaces.
- Handle missing data explicitly.
- Keep API usage efficient and mindful of billing.
- Follow provider documentation and data-storage policies.
- Do not claim that a feature is complete unless it is implemented and verified.

If any requirement cannot be fully implemented because of unavailable API access or missing road-network data, implement the best supported alternative, document the limitation, and keep the architecture ready for a proper implementation later.

---

# 8. Final Deliverables

When implementation is complete, provide:

1. A summary of the existing architecture discovered.
2. The features already present and the features implemented.
3. A list of files created or modified.
4. Database schema and migration details, if applicable.
5. Required environment variables and API configuration.
6. Setup and run instructions.
7. Tests executed and their results.
8. Known limitations and unimplemented requirements.
9. A clear manual testing procedure covering all three tasks.

Begin by inspecting the repository and creating an implementation plan based on the actual code. Then proceed with implementation without unnecessarily waiting for approval at every stage.