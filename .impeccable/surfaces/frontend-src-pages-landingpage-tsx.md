---
version: 1
slug: "frontend-src-pages-landingpage-tsx"
primary_target: "frontend/src/pages/LandingPage.tsx"
related_targets: ["frontend/src/App.tsx"]
---

Scope: WayDine landing page (`/`). Visitor mode: Persuade. App routes (`/plan`, `/results`, `/restaurant/:id`, `/onboarding`, `/profile`) are Operate surfaces inheriting the same world.

Audience: drivers in India, intercity road-trippers and city commuters equally. Job: decide to try WayDine and sign in with Google. Proof: the mechanism itself (extra minutes per stop), no testimonials or counts exist.

## Direction contract

THESIS: The landing page is a trip itinerary, not a marketing hero. It refuses the category default of a phone mockup plus "find restaurants near you" headline; the first thing read is a timed journey with food stops priced in extra minutes.

OWN-WORLD: Existing WayDine world: warm off-white ground #faf8f2, forest green #2f4f2f for structure and route lines, amber #d1891f only for the chosen stop and primary emphasis. Oswald for display and times, IBM Plex Sans for text. Ticket language: perforated edges, ruled rows, tabular times, a dashed route spine with stop dots.

STORY: Visitor sees a real-shaped itinerary (Leave 12:00, three stops each with +minutes, open/veg evidence, arrive 12:22), understands WayDine prices detours in time, sees it works for city hops and highway trips, then signs in with Google to plan their own.

FIRST VIEWPORT: Left 5/12: headline "Eat on the way, not out of the way", one-line mechanism, primary amber-edged green button "Plan a trip with Google sign-in", trip-type toggle (City hop / Highway trip) that swaps the itinerary. Right 7/12: the itinerary ticket at full height, route spine down its left edge, rows animating in with GSAP. Subtle Vanta NET road-network canvas behind, forest green on off-white, disabled under reduced motion.

FORM: Trip itinerary, position 4 on my ordered list, seed key f995911e. Signature interaction: City hop / Highway trip toggle re-times the itinerary rows (GSAP), the chosen stop highlights amber.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Unresolved: none. Itinerary content is illustrative and labelled as an example on the page.
