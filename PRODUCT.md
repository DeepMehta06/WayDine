# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Drivers in India planning a trip who want to eat on the way without a long detour, U-turn or backtracking. Both intercity road-trippers (families and groups, e.g. Mumbai to Pune) and city commuters crossing town (e.g. Kandivali West to Borivali East) are primary; neither is favoured. They use it before leaving or at a stop, often on a phone.

## Product Purpose

WayDine finds restaurants on the actual driving route and ranks them by the real extra driving each stop adds, checked against opening hours at the expected arrival time and the user's saved food preferences. Success: the user picks a stop, sees exactly what it costs in time, and hands the route off to navigation.

## Positioning

Not "restaurants near me": every suggestion is routed to its entrance and back onto the route, so the list is ordered by extra minutes, with direction-of-travel and U-turn evidence, and honest about what is unknown.

## Operating Context

- Google sign-in (OAuth through the backend, cookie session) is required for Google restaurant recommendations.
- Saved account preferences: diet (any / has veg options / pure veg only), cuisines, include unconfirmed dietary info, max extra driving minutes, budget per person in INR.
- Google Places supplies restaurants, rating, rating count, price level/range, meals served, dine-in/takeout, parking, accessibility, payment, up to 5 reviews and photo references. Google Routes supplies the baseline route; Google Maps renders the map. Geoapify powers place search.
- Times are India time (IST).

## Capabilities and Constraints

- India only. Free-tier quotas enforced server-side; Google Places has small daily/monthly limits.
- Live Google Places requests require the owner's explicit approval (AGENTS.md). Photos load only on a restaurant's detail page (max 5), never on result cards.
- Google content (photos, reviews) must show author and Google attribution and must not be stored as a catalogue.
- Unknown data (hours, veg status, price) stays labelled unknown; nothing is inferred from a restaurant's name.

## Brand Commitments

Keep the existing WayDine identity: forest green and amber palette, Oswald display headings, IBM Plex Sans UI text, the fork-and-road icon.

## Evidence on Hand

No testimonials, user counts, partner logos or press exist. Do not fabricate them. Real demonstrations come from live recommendation results only.

## Product Principles

1. Extra minutes first: time cost is the primary fact on every stop.
2. Evidence over claims: show the source and say what is unknown.
3. Phone-first: a driver must be able to choose and navigate one-handed.
4. Hand off, don't replace: navigation opens in the user's map app.
