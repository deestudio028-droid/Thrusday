# The itinerary's JSON

`itinerary.mjs` reads one JSON file and writes the page. Only `title` and `days` (each with
`stops`, each with a `name`) are required, and `currency` once any price is there; every section
appears when its field is there.
Words on the page are yours, in the user's language: set `lang` and `labels` when it is not English.

The page is read the way a traveller reads a trip: pictures first; what it costs and what is
still to price, always in view; the way from place to place; what to do before leaving, by when;
then each day, each place with its pictures, what to do there, what to watch for and its price.
Write for that reader: short lines, the thing to do, never how you found it — that goes in `notes`.

```json
{
  "title": "Lisbon, three easy days",
  "lede": "Food, the river and a palace on a hill, at an easy pace.",
  "lang": "en",
  "place": "Lisbon, Portugal",
  "currency": "GBP",
  "travelers": 2,
  "travel": "transit",
  "cover": { "wiki": "Lisbon" },
  "facts": [
    { "value": "Nov 12 – 15", "label": "3 nights" },
    { "value": "18° / 11°", "label": "Usual high / low" }
  ],
  "route": [
    { "place": "Lisbon", "nights": 2, "dates": "Nov 12–14", "wiki": "Alfama", "next": "Train, 40 min" },
    { "place": "Sintra", "nights": 1, "dates": "Nov 14–15", "wiki": "Sintra" }
  ],
  "musts": [
    { "icon": "ticket", "title": "Book Pena Palace's timed entry", "text": "It sells out on weekends.",
      "when": "By Nov 10", "link": "https://<the ticket page>", "linkText": "Tickets" }
  ],
  "flights": {
    "legs": [
      { "label": "Out", "date": "2026-11-12", "from": "LHR", "to": "LIS", "dep": "07:25", "arr": "10:05",
        "duration": "2h40", "stops": "nonstop", "airline": "<the airline>" }
    ],
    "price": 312, "priceNote": "round trip for 2, taxes in",
    "note": "Seen on Oct 20 on the flight search.", "link": "<the booking link the search gave>"
  },
  "stays": [
    { "name": "<the stay's name>", "area": "Alfama, 5 min walk to the tram", "nights": 2,
      "price": 96, "rating": "4.6 (812 reviews)", "photo": "https://<its own page>",
      "why": "The best-rated private room under £120 a night.", "link": "<its page>" }
  ],
  "climate": "No forecast reaches these days yet; the same days in 2021–2025: highs 18°, lows 11°, rain on 7 of 20 days.",
  "days": [
    { "date": "2026-11-13", "title": "The castle hill, then the palace at Sintra", "weather": "18°/11°, dry",
      "lede": "A day on foot: comfortable shoes.",
      "stops": [
        { "time": "09:30", "name": "São Jorge Castle", "what": "Walk up through Alfama, 20 minutes.",
          "wiki": "São Jorge Castle", "hours": "Open 9:00–18:00", "duration": "About 1½ h",
          "see": ["Walk the walls for the view over the roofs and the river", "The camera obscura in Ulysses Tower"] },
        { "time": "13:00", "name": "Train to Sintra", "move": true, "what": "From Rossio, 40 minutes" },
        { "time": "14:00", "name": "Pena Palace", "wiki": "Pena Palace",
          "what": "The painted palace on the hill; fog makes it a fairy tale.",
          "cost": 20, "costNote": "per person", "book": "Timed entry",
          "watch": "The climb from the gate is long: the shuttle is £4 return.",
          "link": "https://<the ticket page>", "linkText": "Tickets" }
      ] }
  ],
  "costs": [
    { "item": "Flights, 2 people", "kind": "flight", "amount": 312, "note": "round trip" },
    { "item": "<the stay>, 2 nights", "kind": "stay", "amount": 192 },
    { "item": "Sintra stay, 1 night", "kind": "stay", "pending": true, "link": "https://<where to find it>" },
    { "item": "Pena Palace, 2 people", "kind": "ticket", "amount": 40 }
  ],
  "more": [
    { "name": "Pastéis de Belém", "tag": "Eat · £", "what": "The custard tart's first bakery.",
      "near": "30 min by tram 15", "wiki": "Pastéis de Belém" }
  ],
  "fx": "<the line fx.mjs printed>",
  "before": [
    { "icon": "entry", "label": "Entry", "text": "UK passports: up to 90 days in any 180 without a visa." },
    { "icon": "power", "label": "Power", "text": "Type C and F plugs, 230 V: a UK plug needs an adapter." }
  ],
  "notes": ["Entry rules checked for the travellers' passports on 2026-10-20."],
  "sources": [{ "url": "https://<the flight search's page>", "label": "<where the flights came from>" }]
}
```

- **Pictures.** A stop's, a stay's, a route place's or a `more` card's picture is one of three:
  `"wiki"`, the English Wikipedia title of the place (`"pt:Mosteiro dos Jerónimos"` for another
  language's — a place outside the English-speaking world often has an article, or a picture,
  only in its own language), whose lead picture comes with who made it and its licence; `"photo"`
  as a page url, whose own share picture is taken through the browser; `"photo"` as a file beside
  the JSON. An article led by a drawing (a logo, a map) gives none: pick the place's own article.
  **A stop with a `wiki` also gets three more of the place's own pictures** from its Wikimedia
  Commons category, beside its lead one, so a reader sees the place before going; `"gallery":
  false` keeps a stop to its one. `photos` adds up to four of your own (`{ "wiki" }` or
  `{ "photo" }`, with an optional `"caption"`). A page carries 60 pictures at most, and the build
  names the stops left without a gallery. A stop with none shows without — a check-in, a walk.
  Every picture opens large, one after another, when tapped.
- **What to know at a stop** is a few words each, in the user's language, and only what you read
  on the place's own site or a page you name in `sources`: `"see"` (up to four things to do or
  look for there), `"hours"` (the hours on that day, or "Closed Mondays"), `"duration"` (how long
  people stay), `"book"` (true, or what to book: "Timed entry"), `"watch"` (the one thing to watch
  for: a climb, cash only, a queue), `"tip"`. Every stop with `book` is also listed under *Good to
  know* to tick off. A reading you are unsure of goes in `notes`, not on the stop.
- **`"move": true`** makes a stop a move between places — a train, a transfer, the flight home —
  drawn as a line of its own, not a place: its `name`, `time` and `what`.
- **A stop's price** is `cost` (a number in `currency`, or a string) with `costNote` under it
  ("per person", "£20 each"). It is shown, not added up: what the trip costs is `costs`.
- **Costs** are what the money card at the top and the table add up: each `amount` a number in
  `currency`, the price you read; a price you could not read is `"pending": true` with no amount
  (and a `link` to where it is found), said on the page as still to price — never a guess or a
  range. `kind` (`flight`, `stay`, `food`, `ticket`, `transport`, `other`) gives the bar its shares.
  With a price pending, the total is said to be what is settled so far.
- **`route`** is the way from place to place: `place`, `nights`, `dates`, a picture, and `next`,
  how the traveller gets to the following one ("Train, 2 h 40").
- **`musts`** are the few things that go wrong if left undone, each with `when` it must be done
  by: a timed ticket, a restaurant that books out, a visa, a missing direct flight. An `icon`
  from the list below; a `link` to where it is done.
- **`stays`** are the places to sleep, a card each (`stay` alone still works for one). `price` is
  one night's; the stay's total is worked out from `nights`.
- **Every link is a full `http(s)` address** — `flights.link`, a stay's, a stop's or a card's
  `link`, a must's, a cost's, a source's `url`. Anything shorter stops the build by name before a
  single photo is fetched.
- **Maps.** Each stop links to Google Maps by `"<name>, <place>"`; `"map"` sets a better query,
  `"map": false` leaves the stop off the map and off the day's route. Each day gets one link that
  opens its stops in order; `"travel"` is how it gets between them (`transit` unless said), on a
  day or on the trip.
- A day may open on a picture of its own, `"cover"`; each day's `lede` is its one line.
- `facts` are the three or four things someone checks first: dates, where, weather, how.
- A leg of `flights.legs` may carry its own `price` when the two halves were bought apart;
  `flights.note` is a line under the panel, for what the price depends on.
- **`more`** is places beside the plan — somewhere to eat, a sight for a day that runs short —
  shown as cards after the days: `name` (required), `tag` (what it is and its price band, "Eat ·
  €€"), `what`, `near` (how far from the stay or the plan), a picture, `map`, `link`. Three to
  six, or none.
- **`before`** is what to know before going, a line each: `label` and `text`. Entry rules are the
  travellers' passports' and the date you read them goes in `notes`.
- The icons `before` and `musts` take: `entry`, `money`, `tipping`, `power`, `transit`,
  `emergency`, `health`, `internet`, `flight`, `ticket`, `food`, `stay`.
- **`notes`** fold at the end: what was checked and when, what could not be read.
- `sources` takes `{ "url", "label" }`, or a plain string when the source is not a page.
- `labels` renames the page's own words: `way`, `musts`, `flights`, `stay`, `weather`, `days`,
  `more`, `costs`, `before`, `notes`, `bookAhead`, `tip`, `total`, `known`, `pending`, `perPerson`,
  `map`, `route`, `book`, `night`, `nights`, `day`, `photos`, `people`, `close`, `previous`,
  `next`, `sources`. A label with a number in it takes `{n}` where the language puts it:
  `"day": "{n}일차"`, `"nights": "{n}박"`, `"photos": "{n} photos"`.
