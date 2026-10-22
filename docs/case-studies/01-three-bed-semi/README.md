# Case study 01: three-bed semi with garage

The first property used to work out the internal process from a quote
request to a fitted system: how many indoor and outdoor units, the output
each room needs, and where each unit goes.

## Step 1: current floor plan

![Current floor plan](./floor-plan-current.png)

Redrawn from the estate agent's plan (Benson & Partners) with the owner's
mark-up applied. The agent's plan is not to scale, so room sizes here are
the agent's figures and are measured again on survey before any sizing.
Regenerate the drawing with `python3 floor-plan.py floor-plan-current.svg`.

| Floor  | Room             | Agent's size    |
| ------ | ---------------- | --------------- |
| Ground | Open-plan kitchen, dining and living (one room) | was 4.93m x 3.15m (kitchen) + 4.95m x 3.56m (living) |
| Ground | Garage           | not given       |
| First  | Bedroom 1        | 4.88m x 3.40m   |
| First  | Bedroom 2        | 2.49m x 2.36m   |
| First  | Bedroom 3        | 3.12m x 2.54m   |
| First  | Bathroom         | approx. 3.1m x 2.24m (extended; agent's 2.26m x 2.24m was before) |

### Changes from the old plan (orange numbers on the drawing)

1. The lean-to at the back is gone. The kitchen's back door now opens
   straight outside.
2. The inner porch door into the living room is gone; the porch is open to
   the living room.
3. New door from the porch into the garage.
4. The small lobby in front of Bedroom 3, and its door, are gone. The lobby
   space is now part of Bedroom 3.
5. The bathroom door now opens off the landing.
6. Bedroom 3's door now opens off the landing, in its right-hand wall.
7. The bathroom's right-hand wall was knocked down and the bathroom now
   runs over the old cupboard, up to a new wall against Bedroom 2. Its new
   width (about 3.1m) is scaled from the old plan and needs measuring.
8. The wall between the living room and the kitchen/dining room is gone.
   The ground floor (apart from the garage and porch) is one open-plan
   room, with the stairs rising inside it. It is sized as one space.

### To confirm with the owner

- Item 4: is the bathroom's old door into the lobby blocked up, so the
  only way in is the new door off the landing?
- Bedroom 2's door position, which the old plan shows unclearly.
- Which way the house faces, so units can be placed with sun gain in mind.
