# Your TIDAL

**YourTIDAL** is a self-hosted application that tracks what you listen and offers you a dashboard to explore statistics about it!
It's composed of a web server which polls the TIDAL API every now and then and a web application on which you can explore your statistics.

> This is a fork of [Your Spotify](https://github.com/Yooooomi/your_spotify) adapted to work with TIDAL instead of Spotify.

# Table of contents

- [Your TIDAL](#your-tidal)
- [Table of contents](#table-of-contents)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Using `docker-compose`](#using-docker-compose)
  - [Installing locally (not recommended)](#installing-locally-not-recommended)
  - [Environment](#environment)
  - [Advanced CORS settings](#advanced-cors-settings)
- [Creating the TIDAL Application](#creating-the-tidal-application)
- [Importing past history](#importing-past-history)
  - [Supported import methods](#supported-import-methods)
    - [Privacy data](#privacy-data)
  - [Troubleshoot](#troubleshoot)
- [FAQ](#faq)
- [Contributing](#contributing)
- [Sponsoring](#sponsoring)

# Prerequisites

1. You have to own a TIDAL application ID that you can create through their [developer dashboard](https://developer.tidal.com/).
2. You need to provide the **Server** environment the **client** ID AND **secret** key of the application (cf. [Installation](#installation)).
3. You need to provide an **authorized** redirect URI to the `docker-compose` file.

> A tutorial is available at the end of this readme.

# Installation

## Using `docker-compose`

Follow the [docker-compose-example.yml](https://github.com/Medformatik/your_tidal/blob/master/docker-compose-example.yml) to host your application through docker.

```yml
services:
  server:
    image: medformatik/your_tidal_server
    restart: always
    ports:
      - "8080:8080"
    links:
      - mongo
    depends_on:
      - mongo
    environment:
      API_ENDPOINT: http://localhost:8080 # This MUST be included as a valid URL in the TIDAL dashboard (see below)
      CLIENT_ENDPOINT: http://localhost:3000
      TIDAL_CLIENT_ID: __your_tidal_client_id__
      TIDAL_CLIENT_SECRET: __your_tidal_client_secret__
  mongo:
    container_name: mongo
    image: mongo:6
    volumes:
      - ./your_tidal_db:/data/db

  web:
    image: medformatik/your_tidal_client
    restart: always
    ports:
      - "3000:3000"
    environment:
      API_ENDPOINT: http://localhost:8080
```

> Some ARM-based devices might have trouble with Mongo >= 5. I suggest you use the image **mongo:4.4**.

## Installing locally (not recommended)

You can follow the instructions [here](https://github.com/Medformatik/your_tidal/blob/master/LOCAL_INSTALL.md). Note that you will still have to do the steps below.

## Environment

| Key | Default value (if any) | Description |
| :--- | :--- | :--- |
| CLIENT_ENDPOINT       | REQUIRED | The endpoint of your web application |
| API_ENDPOINT          | REQUIRED | The endpoint of your server |
| TIDAL_CLIENT_ID       | REQUIRED | The client ID of your TIDAL application (cf [Creating the TIDAL Application](#creating-the-tidal-application)) |
| TIDAL_CLIENT_SECRET   | REQUIRED | The client secret of your TIDAL application (cf [Creating the TIDAL Application](#creating-the-tidal-application)) |
| TIMEZONE              | Europe/Paris | The timezone of your stats, only affects read requests since data is saved with UTC time |
| MONGO_ENDPOINT        | mongodb://mongo:27017/your_tidal | The endpoint of the Mongo database, where **mongo** is the name of your service in the compose file |
| PROMETHEUS_USERNAME             | _not defined_ | Prometheus basic auth username (see [here](https://github.com/Medformatik/your_tidal/tree/master/apps/server#prometheus)) |
| PROMETHEUS_PASSWORD             | _not defined_ | Prometheus basic auth password |
| LOG_LEVEL             | info | The log level, debug is useful if you encouter any bugs |
| CORS                  | _not defined_ | List of comma-separated origin allowed (not required; defaults to CLIENT_ENDPOINT) |
| COOKIE_VALIDITY_MS    | 1h | Validity time of the authentication cookie, following [this pattern](https://github.com/vercel/ms) |
| MAX_IMPORT_CACHE_SIZE | Infinite | The maximum element in the cache when importing data from an outside source, more cache means less requests to TIDAL, resulting in faster imports |
| MONGO_NO_ADMIN_RIGHTS | false | Do not ask for admin right on the Mongo database |
| PORT                  | 8080 | The port of the server, **do not** modify if you're using docker |
| FRAME_ANCESTORS       | _not defined_ | Sites allowed to frame the website, comma separated list of URLs (`i-want-a-security-vulnerability-and-want-to-allow-all-frame-ancestors` to allow every website) |

## Advanced CORS settings

**Manually specifying CORS configuration is not required for typical deployments.**  
99.9% of users do not need to worry about this, it is handled automatically.

If your use case requires the backend to be used from multiple frontend origins, you can manually adjust the `CORS` variable.
For example, a value of `origin1,origin2` will allow `origin1` and `origin2`.

# Creating the TIDAL Application

For **YourTIDAL** to work you need to provide a TIDAL application **client ID** AND **client secret** to the server environment.
To do so, you need to create a **TIDAL application** [here](https://developer.tidal.com/).

1. Log in to the TIDAL Developer Dashboard
2. Click on **Create New App** or **New Application**
3. Fill out all the required information:
   - App name
   - Description
   - Website URL (optional)
4. Set the redirect URI, corresponding to your **server** location on the internet (or your local network) adding the suffix **/oauth/tidal/callback**
   - i.e: `http://localhost:8080/oauth/tidal/callback` or `http://home.mydomain.com/your_tidal_backend/oauth/tidal/callback`
5. Select the required scopes for your application (reading user data, playback control, etc.)
6. Submit your application for approval (if required)
7. Once approved, copy the **Client ID** and **Client Secret** into your `docker-compose` file under the name of `TIDAL_CLIENT_ID` and `TIDAL_CLIENT_SECRET` respectively.

# Importing past history

By default, **YourTIDAL** will only retrieve data for the past 24 hours once registered. This is a technical limitation. However, you can import previous data if you have exported it from other music platforms.

The import process uses cache to limit requests to the TIDAL API. By default, the cache size is unlimited, but you can limit is with the `MAX_IMPORT_CACHE_SIZE` env variable in the **server**.

## Supported import methods

### Privacy data

> Limited to available data formats.
> May only include recent history.

- If you have exported listening history data from another music platform, you may be able to import it.
- Head to the **Settings** page and choose the appropriate import method.
- Upload your data files in the supported format.
- Start your import.

## Troubleshoot

An import can fail:
- If the server reboots.
- If a request fails 10 times in a row.

A failed import can be retried in the **Settings** page. Be sure to clean your failed imports if you do not want to retry it as it will remove the files used for it.

It is safer to import data at account creation. Though **YourTIDAL** detects duplicates, some may still be inserted.

# FAQ

> How can I block new registrations?

From an admin account, go to the **Settings** page and hit the **Disable new registrations** button.

> Songs don't seem to synchronize anymore.

This can happen if you revoked access on your TIDAL account. To re-sync the songs, go to settings and hit the **Relog to TIDAL** button.

> The web application is telling me it cannot retrieve global preferences.

This means that your web application can't connect to the backend. Check that your **API_ENDPOINT** env variable is reachable from the device you're using the platform from.

> A specific user does not use the application in the same timezone as the server, how can I set a specific timezone for him?

Any user can set his proper timezone in the settings, it will be used for any computed statistics. The timezone of the device will be used for everything else, such as song history.

# Contributing

If you have any issue or any idea that could make the project better, feel free to open an [issue](https://github.com/Medformatik/your_tidal/issues/new/choose). I'd love to hear about new ideas or bugs you are encountering.

# Sponsoring

I work on this project on my spare time and try to fix issues as soon as I can. If you feel generous and think this project and my investment are worth a few cents, you can consider sponsoring it with the button on the right, many thanks.
