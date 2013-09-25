### Features
  * Gmail address tombstones (Aaron's use case) - v2
  * More nuanced privacy filter on reserved rooms - v2 or v3
  * Consider eliminating carpool question
  * Proper interface for cost adjustments - v2 or v3
  * Proper interface for, and handling of, "house host" room reservations - v4
  * Proper switch for closing registration - v5
  * Carpool tool - v5?

### UI
  * Refresh properly if an API call returns unauthorized - v3
  * Switch to a tab-style interface - v3
  * Implement an onbeforeunload handler - v4
  * Rearrange the UI to prefer tabs and guided workflow - v4
  * Improve error reporting in the UI - v4

### Documentation
  * Proper release tagging and version numbering - v1 (naturally)
  * Finish the README - v5
  * Document the Coffeescript and CSS - v5

### Cleanup
  * Refactor the backend - v2
  * Refactor the frontend Coffeescript - v3
  * Clean up the CSS - v5
  * Run HTML and CSS validators - v5
  * Introduce a HTML templating system and make a Makefile - v5
  * Minify the Javascript - v5

### Meta
  * Find and bring up to speed a collaborator - v5+

### Details
  * Make the meals table header look better - v3
  * Guest list counts people by day - v3


## Version 2 backend plan

### Schema

I'd like to adopt a simplified schema that abandons the "persist data between parties" plan, which
is really more trouble than it's worth.  While we're here, we can correct the biggest warts of the
current schema.

**Update**: I've decided to pull the fields out of the JSON objects.  There's not really a reason
not to let the DB know about them, and it will let us write queries that give us precisely the
fields we want, to improve performance.  Maps like "nights" and "meals" will probably still be
JSONs, though.

    Party (party name)
    # No members: it's only here as a root key

    Party
      | Registration (email)
    name: string
    nights: JSON ({id: 'yes' | 'no'})
    meals: JSON ({id: 'yes' | 'no' | 'maybe'})
    rooms_reserved: boolean
    financial: JSON ({subsidy, aid, pledge, adjustment})
    misc: JSON ({phone, full name, dietary, medical, emergency, ride (?), guest})

    Party
      | User (federated identity)
    # Currently no members; maybe one day we'll store preferences

    Party
      | User
          | Authorization (email)
    activated: boolean
    user_nickname: string
    email_token: string
    **tombstone: boolean

    Party
      | Reservation (night ID|room ID)
    unavailable: boolean
    registration: key

    Party
      | Payment (arbitrary ID)
    date: date
    amount: float
    misc: JSON ({source, method of payment})

    Party
      | Payment
          | Credit (arbitrary ID)
    date: date
    amount: float
    registration: key

    ** = new feature

### Separation of duties
The main point is to return close to the DB without overly processing or querying on the server
side; this should dramatically improve performance.

  * model.py:  Getters return JSON-compatible objects, and filter results by email, but otherwise
    essentially return views on the database.  (No more expensive pseudo-joins; ideally it makes one
    query per entity type, asynchronously.)  Setters maintain data consistency but generally do not
    verify authorization.
  * main.py:  Contains the endpoints; verifies authorization.
  * Frontend:  Responsible for synthesizing the database views.  Hey, they're not my CPU cycles.
    (And realistically it is going to be doing a lot of synthesizing anyway; it will be clearer if
    it's centralized.)

### YAML schema
It looks like it will be useful to know which room a bed is in.  This will require rethinking the
YAML schema slightly, although I haven't worked out the details yet.
