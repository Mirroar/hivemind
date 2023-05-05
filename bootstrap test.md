nav data:
before: 404 rooms, 146,4 KB


Me badge:
old: 24 / #251711 / #f7f1bf / #ff931a / shape 0.5
new: 18 / #340000 / #4b381a / #ff0000 / shape -0


Stats on how fast bootstrap is:
On private Server, W6N1, Spawn at 39x35 or 39x34

|          | Initial test | Harvester support | Ignore ramparts | New room planner + "unlimited" remotes | Builders help / W8N3 | Remote rep.
|----------|--------------|-------------------|-----------------|--------| Borked builders | Borked spawns       | 6 remotes / W8N3
| RCL 1    |            0 |                 0 |               0 |     0  |     0           |     0       |     0 |     0        |     0 |     0
| RCL 2    |          954 |              1235 |             960 |  1322  |   869           |  1056       |   485 |   487        |   498 |   608
| RCL 3    |        12181 |             13075 |            9780 | 11400  | 12662           | 11930       |  6803 |  8170        |  6753 |  6940
| Tower    |        15681 |             16350 |           11710 | 12888  | 41117           | 13362       |  9207 | 10614        |  9684 |  9358
| RCL 4    |        25835 |             23881 |           17838 | 23337  | 32787           | 20669       | 15791 | 15369        | 15866 | 15038
| Storage  |        28802 |             25884 |           19895 |        | 40647           | 24706       | 20333 | 19200        | 18581 | 19589
| RCL 5    |              |             52487 |           50598 |        |                 | 56094       |       | 56774        |       | 56731
| Room 2   |              |             70242 |           67256 |        |                 | 76993       |       | 77132        |       | 93169
| RCL 6    |              |            100765 |                 |
| Terminal |              |                   |                 |


TODO:
- harvest spot variations
- place constructionsite when one is finished
- fix early scouting causing exits to be considered safe
- allow even more remote mining (6 at RCL 1-3, 4 at RCL 4+?)

xxscreeps:
- safemodes dropped at exactly the same time?

next steps:
- hotspot manager
  - decides which operations need creeps for protection
- detect newly settled rooms
  - if too close, automated attacks
- convert expansion to operation?
- new rooms: spawn as many remote harvesters as possible
  - if cpu allows it
  - as long as there are sources in range
- try to reduce intents for a room (less transporters?)
