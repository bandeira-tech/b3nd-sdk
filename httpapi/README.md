b3nd/httpapi supports the direct http interface between clients and a b3nd/persistence setup

it enables both reading and writing to a target persistence instance gated by the api server

it's a deno app using hono and supports multiple websites calling cross domain

while it allows extensibility for hardened access control via hono for example, the server does not include any access control out of the box as it is intended both as development tool and educational material
