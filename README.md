b3nd is an all-purpose multi-tenant domain storage backend supporting frontend-only development of multiple applications.

b3nd provides APIs for URL oriented resource management which enables client applications to manage their resources as needed.

## How it works

Say you want to write an application to manage memories with a photo, so you create an HTML with a form

```html
<form src="https://b3nd.fire.cat/api/v1/add">
    <input type="hidden" name="-appkey" value="myappkey" />
    <input type="hidden" name="-uri" value="/memories" />
    <input type="file" name="img" />
    <textarea name="txt" />
    <submit>save</submit>
</form>
```

each part is described

- `src=/api/v1/add` will post to the b3nd/v1/add api which adds a new list item to the given uri
- `-appkey input` is the unique key generated for your app
- `-uri input` is the context resource that is being updated by the form
- both `img` and `txt` are custom inputs makeup the data being submitted by the form

then in the backend a record is created like

```json
{
  img: "<id to image data>",
  txt: "<encrypted text>"
}
```

then display it later with

```html
<script src="https://b3nd.fire.cat/js/v1/html-view.js" />

<ul data-b3nd-appkey="myappkey"
    data-b3nd-source="/memories"
    data-b3nd-filter="">
        <li>
            <img data-b3nd-item-src="img" />
            <span data-b3nd-item-value="-id" />
            <span data-b3nd-item-value="-creation" />
            <p data-b3nd-item-value="txt" />
        </li>
</ul>
```

and also work with client side sdk

```js
const b3nd = require('fire.cat/b3nd/frontend-sdk')
const authenticated = b3nd.withUserKey("myuserkey") // you have to register and request a userkey
const app = authenticated.withAppKey("my-app-xyz")
const [error, result] = await app.add('/memories', { img: '', txt: '' })
const [error, result] = await app.create('/memories', [])
const [error, result] = await app.create('/plans/tokyo-2030', "we going baby")
const [error, result] = await app.update('/plans/tokyo-2030', "we going baby, it gone be good")
```

so the persistence looks like

```
/users/<userkey>/~>/
/users/<userkey>/<appkey>/<app-uri>
/apps/<appkey>/~>/
/apps/<appkey>/<app-uri>

/users/nataliarsand/~>/pubkeys/
/users/nataliarsand/~>/pubkeys/
/users/nataliarsand/milestory.me/books/<book id>/~>/writers
/users/nataliarsand/milestory.me/books/<book id>/entries/1/{title, images, description, ...}
```

## Installation Options

The b3nd HTTP API can be deployed using Docker with various backend configurations:

### PostgreSQL Installation (Recommended for Production)

A batteries-included Docker setup with PostgreSQL persistence:

```bash
cd httpapi/installations/postgres
docker-compose up -d
```

This provides:
- PostgreSQL 16 database with persistent storage
- Pre-configured HTTP API with PostgreSQL client
- Health checks for both services
- Easy environment variable configuration

See [httpapi/installations/postgres/README.md](httpapi/installations/postgres/README.md) for detailed setup instructions and configuration options.

### Other Installation Options

Additional installation configurations are available in `httpapi/installations/` for different deployment scenarios and backend choices.
