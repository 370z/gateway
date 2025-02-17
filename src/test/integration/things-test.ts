import { server, httpServer, chai, mockAdapter } from '../common';
import { TEST_USER, createUser, headerAuth } from '../user';
import e2p from 'event-to-promise';
import { webSocketOpen, webSocketRead, webSocketSend, webSocketClose } from '../websocket-util';
import WebSocket from 'ws';
import EventSource from 'eventsource';
import { AddressInfo } from 'net';
import * as Constants from '../../constants';
import Event from '../../models/event';
import Events from '../../models/events';

const TEST_THING = {
  id: 'test-1',
  title: 'test-1',
  '@context': 'https://webthings.io/schemas',
  '@type': ['OnOffSwitch'],
  properties: {
    power: {
      '@type': 'OnOffProperty',
      type: 'boolean',
      value: false,
    },
    percent: {
      '@type': 'LevelProperty',
      type: 'number',
      value: 20,
    },
  },
};

const VALIDATION_THING = {
  id: 'validation-1',
  title: 'validation-1',
  '@context': 'https://webthings.io/schemas',
  properties: {
    readOnlyProp: {
      type: 'boolean',
      readOnly: true,
      value: true,
    },
    minMaxProp: {
      type: 'number',
      minimum: 10,
      maximum: 20,
      value: 15,
    },
    enumProp: {
      type: 'string',
      enum: ['val1', 'val2', 'val3'],
      value: 'val2',
    },
    multipleProp: {
      type: 'integer',
      minimum: 0,
      maximum: 600,
      value: 10,
      multipleOf: 5,
    },
  },
};

const EVENT_THING = {
  id: 'event-thing1',
  title: 'Event Thing',
  '@context': 'https://webthings.io/schemas',
  events: {
    overheated: {
      type: 'number',
      unit: 'degree celsius',
    },
  },
};

const piDescr = {
  id: 'pi-1',
  title: 'pi-1',
  '@context': 'https://webthings.io/schemas',
  '@type': ['OnOffSwitch'],
  properties: {
    power: {
      '@type': 'OnOffProperty',
      type: 'boolean',
      value: true,
      forms: [
        {
          href: '/properties/power',
          proxy: true,
        },
      ],
    },
  },
  actions: {
    reboot: {
      description: 'Reboot the device',
      forms: [
        {
          href: '/actions/reboot',
          proxy: true,
        },
      ],
    },
  },
  events: {
    reboot: {
      description: 'Going down for reboot',
      forms: [
        {
          href: '/events/reboot',
          proxy: true,
        },
      ],
    },
  },
};

describe('things/', function () {
  let jwt: string;
  beforeEach(async () => {
    jwt = await createUser(server, TEST_USER);
  });

  async function addDevice(desc: Record<string, unknown> = TEST_THING): Promise<ChaiHttp.Response> {
    const { id } = desc;
    const res = await chai
      .request(server)
      .post(Constants.THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send(desc);
    if (res.status !== 201) {
      throw res;
    }
    await mockAdapter().addDevice(<string>id, desc);
    return res;
  }

  function makeDescr(id: string): {
    id: string;
    title: string;
    properties: Record<string, unknown>;
  } {
    return {
      id: id,
      title: id,
      properties: {},
    };
  }

  it('GET with no things', async () => {
    const res = await chai
      .request(server)
      .get(Constants.THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toEqual(0);
  });

  it('fail to create a new thing (empty body)', async () => {
    const err = await chai
      .request(server)
      .post(Constants.THINGS_PATH)
      .set(...headerAuth(jwt))
      .set('Accept', 'application/json')
      .send();
    expect(err.status).toEqual(400);
  });

  it('fail to create a new thing (duplicate)', async () => {
    await addDevice();
    try {
      await addDevice();
    } catch (err) {
      expect((err as ChaiHttp.Response).status).toEqual(400);
    }
  });

  it('GET with 1 thing', async () => {
    await addDevice();
    const res = await chai
      .request(server)
      .get(Constants.THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toEqual(1);
    expect(res.body[0]).toHaveProperty('href');
    expect(res.body[0].href).toEqual(`${Constants.THINGS_PATH}/test-1`);
  });

  it('GET a thing', async () => {
    const thingDescr = JSON.parse(JSON.stringify(piDescr));

    await addDevice(thingDescr);
    const res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/${thingDescr.id}`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toHaveProperty('title');
    expect(res.body.title).toEqual(thingDescr.title);

    // Fix up links
    delete thingDescr.properties.power.forms[0].proxy;
    // eslint-disable-next-line max-len
    thingDescr.properties.power.forms[0].href = `${Constants.PROXY_PATH}/${thingDescr.id}${thingDescr.properties.power.forms[0].href}`;
    thingDescr.properties.power.forms.push({
      href: `${Constants.THINGS_PATH}/${thingDescr.id}${Constants.PROPERTIES_PATH}/power`,
    });

    delete thingDescr.actions.reboot.forms[0].proxy;
    // eslint-disable-next-line max-len
    thingDescr.actions.reboot.forms[0].href = `${Constants.PROXY_PATH}/${thingDescr.id}${thingDescr.actions.reboot.forms[0].href}`;
    thingDescr.actions.reboot.forms.push({
      href: `${Constants.THINGS_PATH}/${thingDescr.id}${Constants.ACTIONS_PATH}/reboot`,
    });

    delete thingDescr.events.reboot.forms[0].proxy;
    // eslint-disable-next-line max-len
    thingDescr.events.reboot.forms[0].href = `${Constants.PROXY_PATH}/${thingDescr.id}${thingDescr.events.reboot.forms[0].href}`;
    thingDescr.events.reboot.forms.push({
      href: `${Constants.THINGS_PATH}/${thingDescr.id}${Constants.EVENTS_PATH}/reboot`,
    });

    delete thingDescr.id;
    delete thingDescr.properties.power.value;

    expect(res.body).toMatchObject(thingDescr);
  });

  // eslint-disable-next-line @typescript-eslint/quotes
  it("GET a thing's proxied resources", async () => {
    const thingDescr = JSON.parse(JSON.stringify(piDescr));

    await addDevice(thingDescr);

    const res = await chai
      .request(server)
      .get(`${Constants.PROXY_PATH}/${thingDescr.id}/properties/power`)
      .set('Accept', 'text/plain')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.text).toEqual('GET /properties/power');
  });

  it('fail to GET a nonexistent thing', async () => {
    await addDevice();
    const err = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/test-2`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(err.status).toEqual(404);
  });

  it('fail to rename a thing', async () => {
    const thingDescr = Object.assign({}, piDescr);

    await addDevice(thingDescr);
    const res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/${thingDescr.id}`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toHaveProperty('title');
    expect(res.body.title).toEqual(thingDescr.title);

    let err = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/${thingDescr.id}`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({});

    expect(err.status).toEqual(400);

    err = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/${thingDescr.id}`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ title: '  \n  ' });

    expect(err.status).toEqual(400);
  });

  it('rename a thing', async () => {
    const thingDescr = Object.assign({}, piDescr);

    await addDevice(thingDescr);
    let res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/${thingDescr.id}`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toHaveProperty('title');
    expect(res.body.title).toEqual(thingDescr.title);

    res = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/${thingDescr.id}`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ title: 'new title' });

    expect(res.status).toEqual(200);

    res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/${thingDescr.id}`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toHaveProperty('title');
    expect(res.body.title).toEqual('new title');
  });

  it('GET all properties of a thing', async () => {
    await addDevice();
    const res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/test-1/properties`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toHaveProperty('power');
    expect(res.body.power).toEqual(false);
    expect(res.body).toHaveProperty('percent');
    expect(res.body.percent).toEqual(20);
  });

  it('GET a property of a thing', async () => {
    await addDevice();
    const res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/test-1/properties/power`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toEqual(false);
  });

  it('fail to GET a nonexistent property of a thing', async () => {
    await addDevice();
    const err = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/test-1/properties/xyz`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(err.status).toEqual(500);
  });

  it('fail to GET a property of a nonexistent thing', async () => {
    const err = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/test-1a/properties/power`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(err.status).toEqual(500);
  });

  it('fail to set a property of a thing', async () => {
    await addDevice();
    const err = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/test-1/properties/power`)
      .type('json')
      .set(...headerAuth(jwt))
      .send();
    expect(err.status).toEqual(400);
  });

  it('fail to set a property of a thing', async () => {
    const err = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/test-1/properties/power`)
      .type('json')
      .set(...headerAuth(jwt))
      .send('foo');
    expect(err.status).toEqual(400);
  });

  it('set a property of a thing', async () => {
    // Set it to true
    await addDevice();
    const on = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/test-1/properties/power`)
      .type('json')
      .set(...headerAuth(jwt))
      .send(JSON.stringify(true));

    expect(on.status).toEqual(204);

    // Check that it was set to true
    const readOn = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/test-1/properties/power`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(readOn.status).toEqual(200);
    expect(readOn.body).toEqual(true);

    // Set it back to false
    const off = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/test-1/properties/power`)
      .type('json')
      .set(...headerAuth(jwt))
      .send(JSON.stringify(false));

    expect(off.status).toEqual(204);

    // Check that it was set to false
    const readOff = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/test-1/properties/power`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(readOff.status).toEqual(200);
    expect(readOff.body).toEqual(false);
  });

  it('set multiple properties of a thing', async () => {
    // Set properties
    await addDevice();
    const setProperties = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/test-1/properties`)
      .type('json')
      .set(...headerAuth(jwt))
      .send(
        JSON.stringify({
          power: true,
          percent: 42,
        })
      );

    expect(setProperties.status).toEqual(204);

    // Check that the properties were set
    const getProperties = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/test-1/properties`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(getProperties.status).toEqual(200);
    expect(getProperties.body.power).toEqual(true);
    expect(getProperties.body.percent).toEqual(42);
  });

  it('fail to set multiple properties of a thing', async () => {
    // Set properties
    await addDevice();
    const setProperties = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/test-1/properties`)
      .type('json')
      .set(...headerAuth(jwt))
      .send(
        JSON.stringify({
          power: true,
          percent: 42,
          invalidpropertyname: true,
        })
      );

    expect(setProperties.status).toEqual(500);
  });

  it('fail to set x and y coordinates of a non-existent thing', async () => {
    const err = await chai
      .request(server)
      .patch(`${Constants.THINGS_PATH}/test-1`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ abc: true });
    expect(err.status).toEqual(404);
  });

  it('fail to set x and y coordinates of a thing', async () => {
    await addDevice();
    const err = await chai
      .request(server)
      .patch(`${Constants.THINGS_PATH}/test-1`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ abc: true });
    expect(err.status).toEqual(400);
  });

  it('set floorplanVisibility of a thing', async () => {
    await addDevice();
    const UPDATED_DESCRIPTION = JSON.parse(JSON.stringify(TEST_THING));
    UPDATED_DESCRIPTION.floorplanVisibility = false;
    const on = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/test-1`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send(UPDATED_DESCRIPTION);

    expect(on.status).toEqual(200);
    expect(on.body).toHaveProperty('floorplanVisibility');
    expect(on.body.floorplanVisibility).toEqual(false);
  });

  it('set x and y coordinates of a thing', async () => {
    await addDevice();
    const on = await chai
      .request(server)
      .patch(`${Constants.THINGS_PATH}/test-1`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ floorplanX: 10, floorplanY: 20 });

    expect(on.status).toEqual(200);
    expect(on.body).toHaveProperty('floorplanX');
    expect(on.body).toHaveProperty('floorplanY');
    expect(on.body.floorplanX).toEqual(10);
    expect(on.body.floorplanY).toEqual(20);
  });

  it('set layout index of a thing', async () => {
    const TEST_THING_2 = JSON.parse(JSON.stringify(TEST_THING));
    TEST_THING_2.id = 'test-2';
    TEST_THING_2.title = 'test-2';
    const TEST_THING_3 = JSON.parse(JSON.stringify(TEST_THING));
    TEST_THING_3.id = 'test-3';
    TEST_THING_3.title = 'test-3';
    await addDevice(TEST_THING);
    await addDevice(TEST_THING_2);
    await addDevice(TEST_THING_3);

    const on = await chai
      .request(server)
      .patch(`${Constants.THINGS_PATH}/test-1`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ layoutIndex: 15 });

    expect(on.status).toEqual(200);
    expect(on.body).toHaveProperty('layoutIndex');
    expect(on.body.layoutIndex).toEqual(2);

    const on2 = await chai
      .request(server)
      .patch(`${Constants.THINGS_PATH}/test-2`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ layoutIndex: 1 });

    expect(on2.status).toEqual(200);
    expect(on2.body).toHaveProperty('layoutIndex');
    expect(on2.body.layoutIndex).toEqual(1);
  });

  it('lists 0 new things after creating thing', async () => {
    await addDevice();
    const res = await chai
      .request(server)
      .get(Constants.NEW_THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toEqual(0);
  });

  it('lists new things when devices are added', async () => {
    await mockAdapter().addDevice('test-2', makeDescr('test-2'));
    await mockAdapter().addDevice('test-3', makeDescr('test-3'));

    const res = await chai
      .request(server)
      .get(Constants.NEW_THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toEqual(2);
    expect(res.body[0]).toHaveProperty('href');
    expect(res.body[0].href).toEqual(`${Constants.THINGS_PATH}/test-2`);
    expect(res.body[1]).toHaveProperty('href');
    expect(res.body[1].href).toEqual(`${Constants.THINGS_PATH}/test-3`);
  });

  it('should send multiple devices during pairing', async () => {
    const ws = await webSocketOpen(Constants.NEW_THINGS_PATH, jwt);

    // We expect things test-4, and test-5 to show up eventually
    const [messages, res] = await Promise.all([
      webSocketRead(ws, 2),
      (async () => {
        const res = await chai
          .request(server)
          .post(`${Constants.ACTIONS_PATH}/pair`)
          .set('Accept', 'application/json')
          .set(...headerAuth(jwt))
          .send({ timeout: 60 });

        await mockAdapter().addDevice('test-4', makeDescr('test-4'));
        await mockAdapter().addDevice('test-5', makeDescr('test-5'));
        return res;
      })(),
    ]);

    const parsedIds = messages.map((msg) => {
      expect(typeof msg.id).toBe('string');
      return msg.id;
    });
    expect(parsedIds.sort()).toEqual(['test-4', 'test-5']);
    expect(res.status).toEqual(201);

    await webSocketClose(ws);
  });

  it('should add a device during pairing then create a thing', async () => {
    const thingId = 'test-6';
    const descr = makeDescr(thingId);
    mockAdapter().pairDevice(thingId, descr);
    // send pair action
    let res = await chai
      .request(server)
      .post(`${Constants.ACTIONS_PATH}/pair`)
      .set(...headerAuth(jwt))
      .set('Accept', 'application/json')
      .send({ timeout: 60 });
    expect(res.status).toEqual(201);

    res = await chai
      .request(server)
      .get(Constants.NEW_THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    let found = false;
    for (const thing of res.body) {
      if (thing.href === `${Constants.THINGS_PATH}/${thingId}`) {
        found = true;
      }
    }
    expect(found);

    res = await chai
      .request(server)
      .post(Constants.THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send(descr);
    expect(res.status).toEqual(201);

    res = await chai
      .request(server)
      .get(Constants.NEW_THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    found = false;
    for (const thing of res.body) {
      if (thing.href === `${Constants.THINGS_PATH}/${thingId}`) {
        found = true;
      }
    }
    expect(!found);

    res = await chai
      .request(server)
      .get(Constants.THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    found = false;
    for (const thing of res.body) {
      if (thing.href === `${Constants.THINGS_PATH}/${thingId}`) {
        found = true;
      }
    }
    expect(found);
  });

  it('should remove a thing', async () => {
    const thingId = 'test-6';
    const descr = makeDescr(thingId);
    mockAdapter().pairDevice(thingId, descr);
    // send pair action
    const pair = await chai
      .request(server)
      .post(`${Constants.ACTIONS_PATH}/pair`)
      .set(...headerAuth(jwt))
      .set('Accept', 'application/json')
      .send({ timeout: 60 });
    expect(pair.status).toEqual(201);

    let res = await chai
      .request(server)
      .delete(`${Constants.THINGS_PATH}/${thingId}`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(204);

    res = await chai
      .request(server)
      .get(Constants.THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    let found = false;
    for (const thing of res.body) {
      if (thing.href === `${Constants.THINGS_PATH}/${thingId}`) {
        found = true;
      }
    }
    expect(!found);
  });

  it('should remove a device', async () => {
    const thingId = 'test-6';
    await addDevice(
      Object.assign({}, TEST_THING, {
        id: thingId,
      })
    );
    const descr = makeDescr(thingId);
    mockAdapter().pairDevice(thingId, descr);
    // send pair action
    const pair = await chai
      .request(server)
      .post(`${Constants.ACTIONS_PATH}/pair`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ timeout: 60 });
    expect(pair.status).toEqual(201);
    await mockAdapter().removeDevice(thingId);

    const res = await chai
      .request(server)
      .get(Constants.NEW_THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    let found = false;
    for (const thing of res.body) {
      if (thing.href === `${Constants.THINGS_PATH}/${thingId}`) {
        found = true;
      }
    }
    expect(!found);
  });

  it('should remove a device in response to unpair', async () => {
    await mockAdapter().addDevice('test-5', makeDescr('test-5'));
    const thingId = 'test-5';
    // The mock adapter requires knowing in advance that we're going to unpair
    // a specific device
    mockAdapter().unpairDevice(thingId);
    let res = await chai
      .request(server)
      .post(`${Constants.ACTIONS_PATH}/pair`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ id: thingId });
    expect(res.status).toEqual(201);

    res = await chai
      .request(server)
      .get(Constants.NEW_THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    let found = false;
    for (const thing of res.body) {
      if (thing.href === `${Constants.THINGS_PATH}/${thingId}`) {
        found = true;
      }
    }

    expect(!found);
  });

  it('should receive propertyStatus messages over websocket', async () => {
    await addDevice();
    const ws = await webSocketOpen(`${Constants.THINGS_PATH}/${TEST_THING.id}`, jwt);

    const [messages, res] = await Promise.all([
      webSocketRead(ws, 3),
      chai
        .request(server)
        .put(`${Constants.THINGS_PATH}/${TEST_THING.id}/properties/power`)
        .type('json')
        .set(...headerAuth(jwt))
        .send(JSON.stringify(true)),
    ]);
    expect(res.status).toEqual(204);
    expect(messages[2].messageType).toEqual(Constants.PROPERTY_STATUS);
    expect((<Record<string, unknown>>messages[2].data).power).toEqual(true);

    await webSocketClose(ws);
  });

  it('should set a property using setProperty over websocket', async () => {
    await addDevice();
    const ws = await webSocketOpen(`${Constants.THINGS_PATH}/${TEST_THING.id}`, jwt);

    await webSocketSend(ws, {
      messageType: Constants.SET_PROPERTY,
      data: {
        power: true,
      },
    });

    const on = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/test-1/properties/power`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(on.status).toEqual(200);
    expect(on.body).toEqual(true);

    await webSocketClose(ws);
  });

  it('should fail to set a nonexistent property using setProperty', async () => {
    await addDevice();
    const ws = await webSocketOpen(`${Constants.THINGS_PATH}/${TEST_THING.id}`, jwt);

    const request = {
      messageType: Constants.SET_PROPERTY,
      data: {
        rutabaga: true,
      },
    };
    const [sendError, messages] = await Promise.all([
      webSocketSend(ws, request),
      webSocketRead(ws, 3),
    ]);

    expect(sendError).toBeFalsy();

    const error = messages[2];
    expect(error.messageType).toBe(Constants.ERROR);
    expect((<Record<string, unknown>>error.data).request).toMatchObject(request);

    await webSocketClose(ws);
  });

  it('should receive an error from sending a malformed message', async () => {
    await addDevice();
    const ws = await webSocketOpen(`${Constants.THINGS_PATH}/${TEST_THING.id}`, jwt);

    const request = 'good morning friend I am not JSON';

    const [sendError, messages] = await Promise.all([
      webSocketSend(ws, request),
      webSocketRead(ws, 3),
    ]);

    expect(sendError).toBeFalsy();

    const error = messages[2];
    expect(error.messageType).toBe(Constants.ERROR);

    await webSocketClose(ws);
  });

  it('should fail to connect to a nonexistent thing over websocket', async () => {
    const ws = await webSocketOpen(`${Constants.THINGS_PATH}/nonexistent-thing`, jwt);

    const messages = await webSocketRead(ws, 1);

    const error = messages[0];
    expect(error.messageType).toBe(Constants.ERROR);
    expect((<Record<string, unknown>>error.data).status).toEqual('404 Not Found');

    if (ws.readyState !== WebSocket.CLOSED) {
      await e2p(ws, 'close');
    }
  });

  it('should only receive propertyStatus messages from the connected thing', async () => {
    await addDevice();
    const otherThingId = 'test-7';
    await addDevice(
      Object.assign({}, TEST_THING, {
        id: otherThingId,
        title: otherThingId,
      })
    );
    const ws = await webSocketOpen(`${Constants.THINGS_PATH}/${TEST_THING.id}`, jwt);

    // PUT test-7 on true, then test-1 on true, then test-1 on false. If we
    // receive an update that on is true twice, we know that the WS received
    // both test-7 and test-1's statuses. If we receive true then false, the
    // WS correctly received both of test-1's statuses.
    const [res, messages] = await Promise.all([
      chai
        .request(server)
        .put(`${Constants.THINGS_PATH}/${otherThingId}/properties/power`)
        .type('json')
        .set(...headerAuth(jwt))
        .send(JSON.stringify(true))
        .then(() => {
          return chai
            .request(server)
            .put(`${Constants.THINGS_PATH}/${TEST_THING.id}/properties/power`)
            .type('json')
            .set(...headerAuth(jwt))
            .send(JSON.stringify(true));
        })
        .then(() => {
          return chai
            .request(server)
            .put(`${Constants.THINGS_PATH}/${TEST_THING.id}/properties/power`)
            .type('json')
            .set(...headerAuth(jwt))
            .send(JSON.stringify(false));
        }),
      webSocketRead(ws, 4),
    ]);

    expect(res.status).toEqual(204);

    expect(messages[2].messageType).toEqual(Constants.PROPERTY_STATUS);
    expect((<Record<string, unknown>>messages[2].data).power).toEqual(true);

    expect(messages[3].messageType).toEqual(Constants.PROPERTY_STATUS);
    expect((<Record<string, unknown>>messages[3].data).power).toEqual(false);

    await webSocketClose(ws);
  });

  it('should receive event notifications over websocket', async () => {
    await addDevice();
    const ws = await webSocketOpen(`${Constants.THINGS_PATH}/${TEST_THING.id}`, jwt);

    const eventAFirst = new Event('a', 'just a cool event', TEST_THING.id);
    const eventB = new Event('b', 'just a boring event', TEST_THING.id);
    const eventASecond = new Event('a', 'just another cool event', TEST_THING.id);

    const subscriptionRequest = {
      messageType: Constants.ADD_EVENT_SUBSCRIPTION,
      data: {
        a: {},
      },
    };

    await webSocketSend(ws, subscriptionRequest);

    const [res, messages] = await Promise.all([
      (async () => {
        await new Promise((res) => {
          setTimeout(res, 0);
        });
        Events.add(eventAFirst);
        Events.add(eventB);
        Events.add(eventASecond);
        return true;
      })(),
      webSocketRead(ws, 4),
    ]);

    expect(res).toBeTruthy();

    expect(messages[2].messageType).toEqual(Constants.EVENT);
    expect(messages[2].data).toHaveProperty(eventAFirst.getName());
    expect((<Record<string, unknown>>messages[2].data)[eventAFirst.getName()]).toHaveProperty(
      'data'
    );
    expect(
      (<Record<string, unknown>>(<Record<string, unknown>>messages[2].data)[eventAFirst.getName()])
        .data
    ).toEqual(eventAFirst.getData());

    expect(messages[3].messageType).toEqual(Constants.EVENT);
    expect(messages[3].data).toHaveProperty(eventASecond.getName());
    expect((<Record<string, unknown>>messages[3].data)[eventASecond.getName()]).toHaveProperty(
      'data'
    );
    expect(
      (<Record<string, unknown>>(<Record<string, unknown>>messages[3].data)[eventASecond.getName()])
        .data
    ).toEqual(eventASecond.getData());

    await webSocketClose(ws);
  });

  it('should be able to retrieve events', async () => {
    await addDevice();

    let res = await chai
      .request(server)
      .get(Constants.EVENTS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toEqual(0);

    res = await chai
      .request(server)
      .get(`${Constants.EVENTS_PATH}/a`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toEqual(0);

    const thingBase = `${Constants.THINGS_PATH}/${TEST_THING.id}`;

    res = await chai
      .request(server)
      .get(thingBase + Constants.EVENTS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toEqual(0);

    res = await chai
      .request(server)
      .get(`${thingBase}${Constants.EVENTS_PATH}/a`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toEqual(0);

    const eventA = new Event('a', 'just a cool event', TEST_THING.id);
    const eventB = new Event('b', 'just a boring event', TEST_THING.id);
    await Events.add(eventA);
    await Events.add(eventB);

    res = await chai
      .request(server)
      .get(thingBase + Constants.EVENTS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toEqual(2);
    expect(res.body[0]).toHaveProperty('a');
    expect(res.body[0].a).toHaveProperty('data');
    expect(res.body[0].a.data).toBe('just a cool event');
    expect(res.body[0].a).toHaveProperty('timestamp');
    expect(res.body[1]).toHaveProperty('b');
    expect(res.body[1].b).toHaveProperty('data');
    expect(res.body[1].b.data).toBe('just a boring event');
    expect(res.body[1].b).toHaveProperty('timestamp');

    res = await chai
      .request(server)
      .get(`${thingBase}${Constants.EVENTS_PATH}/a`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(Array.isArray(res.body)).toBeTruthy();
    expect(res.body.length).toEqual(1);
    expect(res.body[0]).toHaveProperty('a');
    expect(res.body[0].a).toHaveProperty('data');
    expect(res.body[0].a.data).toBe('just a cool event');
    expect(res.body[0].a).toHaveProperty('timestamp');
  });

  it('should be able to subscribe to an event using EventSource', async () => {
    await addDevice(EVENT_THING);
    const address = <AddressInfo>httpServer.address();

    const eventSourceURL =
      `http://127.0.0.1:${address.port}${Constants.THINGS_PATH}/` +
      `${EVENT_THING.id}/events/overheated?jwt=${jwt}`;
    const eventSource = new EventSource(eventSourceURL) as EventTarget & EventSource;
    await e2p(eventSource, 'open');
    const overheatedEvent = new Event('overheated', 101, EVENT_THING.id);
    const [, event] = await Promise.all([
      Events.add(overheatedEvent),
      e2p(eventSource, 'overheated'),
    ]);
    expect(event.type).toEqual('overheated');
    expect(JSON.parse(event.data)).toEqual(101);
    eventSource.close();
  });

  it('should be able to subscribe to all events on a thing using EventSource', async () => {
    await addDevice(EVENT_THING);
    const address = <AddressInfo>httpServer.address();

    const eventSourceURL =
      `http://127.0.0.1:${address.port}${Constants.THINGS_PATH}/` +
      `${EVENT_THING.id}/events?jwt=${jwt}`;
    const eventsSource = new EventSource(eventSourceURL) as EventTarget & EventSource;
    await e2p(eventsSource, 'open');
    const overheatedEvent2 = new Event('overheated', 101, EVENT_THING.id);
    const [, event2] = await Promise.all([
      Events.add(overheatedEvent2),
      e2p(eventsSource, 'overheated'),
    ]);
    expect(event2.type).toEqual('overheated');
    expect(JSON.parse(event2.data)).toEqual(101);
    eventsSource.close();
  });

  it('should not be able to subscribe events on a thing that doesnt exist', async () => {
    await addDevice(EVENT_THING);
    const address = <AddressInfo>httpServer.address();

    const eventSourceURL =
      `http://127.0.0.1:${address.port}${Constants.THINGS_PATH}` +
      `/non-existent-thing/events/overheated?jwt=${jwt}`;
    const thinglessEventSource = new EventSource(eventSourceURL) as EventTarget & EventSource;
    thinglessEventSource.onerror = jest.fn();
    thinglessEventSource.onopen = jest.fn();
    await e2p(thinglessEventSource, 'error');
    expect(thinglessEventSource.onopen).not.toBeCalled();
    expect(thinglessEventSource.onerror).toBeCalled();
  });

  it('should not be able to subscribe to an event that doesnt exist', async () => {
    await addDevice(EVENT_THING);
    const address = <AddressInfo>httpServer.address();

    const eventSourceURL =
      `http://127.0.0.1:${address.port}${Constants.THINGS_PATH}` +
      `${EVENT_THING.id}/events/non-existentevent?jwt=${jwt}`;
    const eventlessEventSource = new EventSource(eventSourceURL) as EventTarget & EventSource;
    eventlessEventSource.onerror = jest.fn();
    eventlessEventSource.onopen = jest.fn();
    await e2p(eventlessEventSource, 'error');
    expect(eventlessEventSource.onopen).not.toBeCalled();
    expect(eventlessEventSource.onerror).toBeCalled();
  });

  // eslint-disable-next-line @typescript-eslint/quotes
  it("should receive thing's action status messages over websocket", async () => {
    await addDevice();
    const ws = await webSocketOpen(`${Constants.THINGS_PATH}/${TEST_THING.id}`, jwt);

    const [actionHref, messages] = await Promise.all([
      (async () => {
        await chai
          .request(server)
          .post(`${Constants.ACTIONS_PATH}/pair`)
          .set('Accept', 'application/json')
          .set(...headerAuth(jwt))
          .send({ timeout: 60 });

        let res = await chai
          .request(server)
          .get(Constants.ACTIONS_PATH)
          .set('Accept', 'application/json')
          .set(...headerAuth(jwt));
        expect(res.status).toEqual(200);
        expect(Object.keys(res.body).length).toEqual(1);
        const actionHref = res.body.pair[0].href;

        res = await chai
          .request(server)
          .delete(actionHref)
          .set('Accept', 'application/json')
          .set(...headerAuth(jwt));
        expect(res.status).toEqual(204);

        res = await chai
          .request(server)
          .get(Constants.ACTIONS_PATH)
          .set('Accept', 'application/json')
          .set(...headerAuth(jwt));

        expect(Object.keys(res.body).length).toEqual(0);

        return actionHref;
      })(),
      webSocketRead(ws, 5),
    ]);

    expect(messages[2].messageType).toEqual(Constants.ACTION_STATUS);
    expect(
      (<Record<string, unknown>>(<Record<string, unknown>>messages[2].data).pair).status
    ).toEqual('pending');
    expect(
      (<Record<string, unknown>>(<Record<string, unknown>>messages[2].data).pair).href
    ).toEqual(actionHref);

    expect(messages[3].messageType).toEqual(Constants.ACTION_STATUS);
    expect(
      (<Record<string, unknown>>(<Record<string, unknown>>messages[3].data).pair).status
    ).toEqual('running');
    expect(
      (<Record<string, unknown>>(<Record<string, unknown>>messages[3].data).pair).href
    ).toEqual(actionHref);

    expect(messages[4].messageType).toEqual(Constants.ACTION_STATUS);
    expect(
      (<Record<string, unknown>>(<Record<string, unknown>>messages[4].data).pair).status
    ).toEqual('deleted');
    expect(
      (<Record<string, unknown>>(<Record<string, unknown>>messages[4].data).pair).href
    ).toEqual(actionHref);

    await webSocketClose(ws);
  });

  it('should close websocket connections on thing deletion', async () => {
    await addDevice();
    const ws = await webSocketOpen(`${Constants.THINGS_PATH}/${TEST_THING.id}`, jwt);

    const res = await chai
      .request(server)
      .delete(`${Constants.THINGS_PATH}/${TEST_THING.id}`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(204);

    await e2p(ws, 'close');
  });

  it('creates and gets the actions of a thing', async () => {
    await addDevice(piDescr);

    const thingBase = `${Constants.THINGS_PATH}/${piDescr.id}`;

    let res = await chai
      .request(server)
      .get(thingBase)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);

    res = await chai
      .request(server)
      .post(`${thingBase}${Constants.ACTIONS_PATH}/reboot`)
      .set(...headerAuth(jwt))
      .set('Accept', 'application/json')
      .send();
    expect(res.status).toEqual(201);

    res = await chai
      .request(server)
      .get(thingBase + Constants.ACTIONS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);
    expect(Object.keys(res.body).length).toEqual(1);
    expect(res.body).toHaveProperty('reboot');
    expect(Array.isArray(res.body.reboot));
    expect(res.body.reboot[0]).toHaveProperty('href');
    expect(res.body.reboot[0].href.startsWith(thingBase)).toBeTruthy();

    // Expect it to not show up in the root (Gateway's) actions route
    res = await chai
      .request(server)
      .get(Constants.ACTIONS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);
    expect(Object.keys(res.body).length).toEqual(0);
  });

  it('fails to create an action on a nonexistent thing', async () => {
    const thingBase = `${Constants.THINGS_PATH}/nonexistent-thing`;

    const input = {
      timeout: 60,
    };

    const err = await chai
      .request(server)
      .post(`${thingBase}${Constants.ACTIONS_PATH}/pair`)
      .set(...headerAuth(jwt))
      .set('Accept', 'application/json')
      .send(input);
    expect(err.status).toEqual(404);
  });

  it('fails to create thing action which does not exist', async () => {
    await addDevice(piDescr);

    const thingBase = `${Constants.THINGS_PATH}/${piDescr.id}`;

    const res = await chai
      .request(server)
      .get(thingBase)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);

    const input = {
      timeout: 60,
    };

    const err = await chai
      .request(server)
      .post(`${thingBase}${Constants.ACTIONS_PATH}/pair`)
      .set(...headerAuth(jwt))
      .set('Accept', 'application/json')
      .send(input);
    expect(err.status).toEqual(400);
  });

  it('should create an action over websocket', async () => {
    await addDevice(piDescr);
    const thingBase = `${Constants.THINGS_PATH}/${piDescr.id}`;
    const ws = await webSocketOpen(thingBase, jwt);

    const messages = (
      await Promise.all([
        webSocketSend(ws, {
          messageType: Constants.REQUEST_ACTION,
          data: {
            reboot: {
              input: {},
            },
          },
        }),
        webSocketRead(ws, 2),
      ])
    )[1];

    const actionStatus = messages[1];
    expect(actionStatus.messageType).toEqual(Constants.ACTION_STATUS);
    expect(actionStatus.data).toHaveProperty('reboot');

    const res = await chai
      .request(server)
      .get(thingBase + Constants.ACTIONS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));
    expect(res.status).toEqual(200);
    expect(Object.keys(res.body).length).toEqual(1);
    expect(Array.isArray(res.body.reboot));
    expect(res.body.reboot[0]).toHaveProperty('href');
    expect(res.body.reboot[0].href.startsWith(thingBase)).toBeTruthy();

    await webSocketClose(ws);
  });

  it('should fail to create an unknown action over websocket', async () => {
    await addDevice(piDescr);
    const thingBase = `${Constants.THINGS_PATH}/${piDescr.id}`;
    const ws = await webSocketOpen(thingBase, jwt);

    const messages = (
      await Promise.all([
        webSocketSend(ws, {
          messageType: Constants.REQUEST_ACTION,
          data: {
            pair: {
              input: {
                timeout: 60,
              },
            },
          },
        }),
        webSocketRead(ws, 3),
      ])
    )[1];

    const created = messages[1];
    expect(created.messageType).toEqual(Constants.ACTION_STATUS);
    expect((<Record<string, unknown>>(<Record<string, unknown>>created.data).pair).status).toEqual(
      'pending'
    );

    const err = messages[2];
    expect(err.messageType).toEqual(Constants.ERROR);

    await webSocketClose(ws);
  });

  it('should fail to handle an unknown websocket messageType', async () => {
    await addDevice(piDescr);
    const thingBase = `${Constants.THINGS_PATH}/${piDescr.id}`;
    const ws = await webSocketOpen(thingBase, jwt);

    const messages = (
      await Promise.all([
        webSocketSend(ws, {
          messageType: 'tomato',
          data: {},
        }),
        webSocketRead(ws, 2),
      ])
    )[1];

    const actionStatus = messages[1];
    expect(actionStatus.messageType).toEqual(Constants.ERROR);

    await webSocketClose(ws);
  });

  it('fail to set PIN for device', async () => {
    await addDevice(piDescr);

    const err = await chai
      .request(server)
      .patch(Constants.THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ thingId: piDescr.id, pin: '0000' });

    expect(err.status).toEqual(400);
  });

  it('set PIN for device', async () => {
    await addDevice(piDescr);

    const res = await chai
      .request(server)
      .patch(Constants.THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ thingId: piDescr.id, pin: '1234' });

    expect(res.status).toEqual(200);
    expect(res.body).toHaveProperty('title');
    expect(res.body.title).toEqual(piDescr.title);
  });

  it('fail to set credentials for device', async () => {
    await addDevice(piDescr);

    const err = await chai
      .request(server)
      .patch(Constants.THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ thingId: piDescr.id, username: 'fake', password: 'wrong' });

    expect(err.status).toEqual(400);
  });

  it('set credentials for device', async () => {
    await addDevice(piDescr);

    const res = await chai
      .request(server)
      .patch(Constants.THINGS_PATH)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt))
      .send({ thingId: piDescr.id, username: 'test-user', password: 'Password-1234!' });

    expect(res.status).toEqual(200);
    expect(res.body).toHaveProperty('title');
    expect(res.body.title).toEqual(piDescr.title);
  });

  it('fail to set read-only property', async () => {
    await addDevice(VALIDATION_THING);

    let res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/validation-1/properties/readOnlyProp`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toEqual(true);

    const err = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/validation-1/properties/readOnlyProp`)
      .type('json')
      .set(...headerAuth(jwt))
      .send(JSON.stringify(false));
    expect(err.status).toEqual(400);

    res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/validation-1/properties/readOnlyProp`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toEqual(true);
  });

  it('fail to set invalid number property value', async () => {
    await addDevice(VALIDATION_THING);

    let res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/validation-1/properties/minMaxProp`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toEqual(15);

    let err = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/validation-1/properties/minMaxProp`)
      .type('json')
      .set(...headerAuth(jwt))
      .send(JSON.stringify(0));
    expect(err.status).toEqual(400);

    res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/validation-1/properties/minMaxProp`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toEqual(15);

    err = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/validation-1/properties/minMaxProp`)
      .type('json')
      .set(...headerAuth(jwt))
      .send(JSON.stringify(30));
    expect(err.status).toEqual(400);

    res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/validation-1/properties/minMaxProp`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toEqual(15);

    res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/validation-1/properties/multipleProp`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toEqual(10);

    err = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/validation-1/properties/multipleProp`)
      .type('json')
      .set(...headerAuth(jwt))
      .send(JSON.stringify(3));
    expect(err.status).toEqual(400);

    res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/validation-1/properties/multipleProp`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toEqual(10);

    res = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/validation-1/properties/multipleProp`)
      .type('json')
      .set(...headerAuth(jwt))
      .send(JSON.stringify(30));
    expect(res.status).toEqual(204);

    res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/validation-1/properties/multipleProp`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toEqual(30);
  });

  it('fail to set invalid enum property value', async () => {
    await addDevice(VALIDATION_THING);

    let res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/validation-1/properties/enumProp`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toEqual('val2');

    const err = await chai
      .request(server)
      .put(`${Constants.THINGS_PATH}/validation-1/properties/enumProp`)
      .type('json')
      .set(...headerAuth(jwt))
      .send(JSON.stringify('val0'));
    expect(err.status).toEqual(400);

    res = await chai
      .request(server)
      .get(`${Constants.THINGS_PATH}/validation-1/properties/enumProp`)
      .set('Accept', 'application/json')
      .set(...headerAuth(jwt));

    expect(res.status).toEqual(200);
    expect(res.body).toEqual('val2');
  });
});
