Problem Statement: WayDine – Smart Pitstop System
Navigation applications often suggest restaurants based on proximity, without considering the vehicle's direction, route, road accessibility, or estimated arrival time. This can lead to unnecessary detours and U-turns.

Hackathon Challenge:
Develop WayDine, a route-based restaurant recommendation system that identifies convenient food stops using data structures, algorithms, graph theory, database management, and rule-based logic, without using AI/ML models.

Task A: Route-Based Recommendations

Identify restaurants located along the planned route and within 200 metres of the highway.

Use graph traversal and shortest-path algorithms to minimize detours.

Exclude restaurants that require significant backward travel or unnecessary diversions.

Task B: Direction and Road-Side Filtering

Determine the vehicle's direction of travel using route coordinates and road information.

Recommend restaurants accessible from the specified side of the highway.

Avoid recommendations that require unnecessary U-turns or crossing the highway.

Task C: Time-Based Food Recommendations

Recommend food options based on the estimated arrival time at a restaurant.

Use predefined rules to suggest breakfast, lunch, dinner, or snacks according to the time of day.

Filter restaurants based on food availability, opening hours, and user preferences stored in the database.

Expected Outcome:
A working application that recommends suitable restaurants along a vehicle's route using core computer science concepts, database queries, graph algorithms, and predefined decision rules, without relying on AI/ML models.