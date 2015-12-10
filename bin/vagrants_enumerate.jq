[ .machines as $in
| .machines
| keys[]
| $in[.] + {"id":.}
| {"name":.name, "id":.id[0:7], "state":.state}]
| map(select(.state=="running"))
| .[]
| join("::")
