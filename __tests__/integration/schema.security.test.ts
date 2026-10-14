// Integration tests: run supabase/schema.sql in an in-process Postgres and act as
// each app role to verify Row Level Security, column grants, triggers and RPCs.
import { bootDatabase, Harness } from './pgHarness';

jest.setTimeout(60_000);

let h: Harness;
let adminId: string;
let managerId: string;
let driverId: string;       // auth/profile id of the driver user
let otherDriverId: string;
let driverRowId: string;    // drivers.id linked to driverId
let otherDriverRowId: string;
let vehicleId: string;
let seq = 0;
const email = (name: string) => `${name}-${++seq}@example.com`;

const expectDenied = async (p: Promise<unknown>, pattern: RegExp = /permission denied|42501|only|cannot|can only|closed|row-level security/i) => {
  await expect(p).rejects.toThrow(pattern);
};

const insertTrip = async (fields: Record<string, unknown> = {}) => {
  const row = {
    departure_time: new Date().toISOString(),
    driver_id: driverRowId,
    driver_user_id: driverId,
    vehicle_id: vehicleId,
    trip_status: 'pending',
    status: 'pending',
    quantity: '10',
    ...fields,
  };
  const cols = Object.keys(row);
  const [trip] = await h.as(adminId, q =>
    q(`insert into trips (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning *`, Object.values(row))
  );
  return trip;
};

beforeAll(async () => {
  h = await bootDatabase();
  adminId = await h.createUserWithRole(email('admin'), 'admin');
  managerId = await h.createUserWithRole(email('manager'), 'manager');
  driverId = await h.createUser(email('driver'));
  otherDriverId = await h.createUser(email('driver2'));

  [{ id: driverRowId }] = await h.owner(
    `insert into drivers (full_name, age, aadhaar_number, pan_number, profile_id, user_id, license_expiry)
     values ('Ravi', 30, '123412341234', 'ABCDE1234F', $1, $1, current_date + 10) returning id`,
    [driverId]
  );
  [{ id: otherDriverRowId }] = await h.owner(
    `insert into drivers (full_name, age, profile_id, user_id) values ('Other', 40, $1, $1) returning id`,
    [otherDriverId]
  );
  [{ id: vehicleId }] = await h.owner(
    `insert into vehicles (registration_number, odometer_reading, insurance_expiry)
     values ('HR55AB1234', 1000, current_date + 5) returning id`
  );
});

afterAll(async () => {
  await h?.close();
});

describe('signup & roles', () => {
  it('ignores a role smuggled in signup metadata', async () => {
    const id = await h.createUser(email('evil'), { role: 'admin' });
    const [p] = await h.owner('select role from profiles where id = $1', [id]);
    expect(p.role).toBe('driver');
  });

  it('lets a user edit their own name but not their role', async () => {
    await h.as(driverId, q => q(`update profiles set full_name = 'Ravi K' where id = $1`, [driverId]));
    const [p] = await h.owner('select full_name from profiles where id = $1', [driverId]);
    expect(p.full_name).toBe('Ravi K');

    await expectDenied(h.as(driverId, q => q(`update profiles set role = 'admin' where id = $1`, [driverId])));
  });

  it('stops managers from changing roles and admins from changing their own', async () => {
    await expectDenied(h.as(managerId, q => q(`update profiles set role = 'admin' where id = $1`, [managerId])));
    await expectDenied(h.as(adminId, q => q(`update profiles set role = 'driver' where id = $1`, [adminId])));
  });

  it('lets an admin promote another user and audits it', async () => {
    const id = await h.createUser(email('promote'));
    await h.as(adminId, q => q(`update profiles set role = 'manager' where id = $1`, [id]));
    const [audit] = await h.owner(
      `select actor_id, old_value, new_value from audit_logs where action = 'role_change' and entity_id = $1`,
      [id]
    );
    expect(audit.actor_id).toBe(adminId);
    expect(audit.old_value.role).toBe('driver');
    expect(audit.new_value.role).toBe('manager');
  });

  it('cuts off a deactivated user entirely', async () => {
    const id = await h.createUserWithRole(email('fired'), 'manager');
    await h.as(adminId, q => q(`update profiles set is_active = false where id = $1`, [id]));
    const rows = await h.as(id, q => q('select id from vehicles'));
    expect(rows).toHaveLength(0);
  });

  it('gives anonymous callers nothing', async () => {
    // trips' RLS subquery touches drivers, which anon has no grant on: denied outright
    await expectDenied(h.as(null, q => q('select id from trips')));
    expect(await h.as(null, q => q('select id from profiles'))).toHaveLength(0);
    expect(await h.as(null, q => q('select id from vehicles'))).toHaveLength(0);
    await expectDenied(h.as(null, q => q('select id from drivers')));
  });
});

describe('driver PII (Aadhaar / PAN)', () => {
  it('is not selectable from the drivers table by any app role', async () => {
    for (const uid of [adminId, managerId, driverId]) {
      await expectDenied(h.as(uid, q => q('select aadhaar_number from drivers')));
    }
    const rows = await h.as(managerId, q => q('select id, full_name from drivers'));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('is readable through get_driver_pii by admins and the owning driver only', async () => {
    const [adminView] = await h.as(adminId, q => q('select * from get_driver_pii($1)', [driverRowId]));
    expect(adminView.aadhaar_number).toBe('123412341234');
    expect(await h.as(managerId, q => q('select * from get_driver_pii($1)', [driverRowId]))).toHaveLength(0);
    expect(await h.as(otherDriverId, q => q('select * from get_driver_pii($1)', [driverRowId]))).toHaveLength(0);
    const [own] = await h.as(driverId, q => q('select * from get_my_driver_profile()'));
    expect(own.pan_number).toBe('ABCDE1234F');
  });

  it('is stripped from audit log entries (managers can read audit_logs)', async () => {
    await h.as(adminId, q => q(`update drivers set address = 'Panipat' where id = $1`, [driverRowId]));
    const [entry] = await h.as(managerId, q =>
      q(`select old_value, new_value from audit_logs where entity_type = 'drivers' and entity_id = $1 order by id desc limit 1`, [driverRowId])
    );
    expect(entry.new_value.address).toBe('Panipat');
    expect(entry.new_value).not.toHaveProperty('aadhaar_number');
    expect(entry.old_value).not.toHaveProperty('pan_number');
  });
});

describe('save_my_driver_profile', () => {
  it('claims an unlinked admin-created record with the same email', async () => {
    const mail = email('claim');
    const [{ id: preRow }] = await h.owner(`insert into drivers (full_name, email) values ('Pre', $1) returning id`, [mail]);
    const uid = await h.createUser(mail);
    const [{ save_my_driver_profile: savedId }] = await h.as(uid, q =>
      q(`select save_my_driver_profile('Suresh', 35, 'Rohtak', '999988887777', 'abcde1234f')`)
    );
    expect(savedId).toBe(preRow);
    const [row] = await h.owner('select profile_id, pan_number from drivers where id = $1', [preRow]);
    expect(row).toEqual({ profile_id: uid, pan_number: 'ABCDE1234F' });
  });

  it('does not hand an admin-created record to an unconfirmed email', async () => {
    const mail = email('squatter');
    const [{ id: preRow }] = await h.owner(
      `insert into drivers (full_name, email, aadhaar_number) values ('Real Person', $1, '111122223333') returning id`, [mail]
    );
    const uid = await h.createUser(mail, {}, false);
    expect((await h.as(uid, q => q('select claim_my_driver_record() as id')))[0].id).toBeNull();
    expect(await h.as(uid, q => q('select * from get_driver_pii($1)', [preRow]))).toHaveLength(0);
  });

  it('links on login and exposes trips assigned before the account existed', async () => {
    const mail = email('late');
    const [{ id: preRow }] = await h.owner(`insert into drivers (full_name, email) values ('Late', $1) returning id`, [mail]);
    const trip = await insertTrip({ driver_id: preRow, driver_user_id: null });
    const uid = await h.createUser(mail);
    const [{ id }] = await h.as(uid, q => q('select claim_my_driver_record() as id'));
    expect(id).toBe(preRow);
    expect(await h.as(uid, q => q('select id from trips where id = $1', [trip.id]))).toHaveLength(1);
  });

  it('validates input and is refused to staff', async () => {
    const uid = await h.createUser(email('bad'));
    await expect(h.as(uid, q => q(`select save_my_driver_profile('X', 30, '', '123', 'ABCDE1234F')`))).rejects.toThrow(/aadhaar/);
    await expectDenied(h.as(managerId, q => q(`select save_my_driver_profile('X', 30, '', '123412341234', 'ABCDE1234F')`)));
  });
});

describe('trips', () => {
  it('assigns a trip number and records the initial status', async () => {
    const trip = await insertTrip();
    expect(trip.trip_number).toMatch(/^CT-\d{6}$/);
    const history = await h.owner('select old_status, new_status from trip_status_history where trip_id = $1', [trip.id]);
    expect(history).toEqual([{ old_status: null, new_status: 'pending' }]);
  });

  it('forbids drivers from creating trips', async () => {
    await expectDenied(h.as(driverId, q =>
      q(`insert into trips (departure_time, driver_user_id) values (now(), $1)`, [driverId])
    ));
  });

  it('lets a driver start and complete their trip; distance and vehicle odometer follow', async () => {
    const trip = await insertTrip();
    await h.as(driverId, q => q(
      `update trips set trip_status = 'active', status = 'active', odometer_start = 1000 where id = $1`, [trip.id]
    ));
    await h.as(driverId, q => q(
      `update trips set trip_status = 'completed', status = 'completed', arrival_time = now(), odometer_end = 1250 where id = $1`,
      [trip.id]
    ));
    const [after] = await h.owner('select distance_travelled_km from trips where id = $1', [trip.id]);
    expect(Number(after.distance_travelled_km)).toBe(250);
    const [veh] = await h.owner('select odometer_reading from vehicles where id = $1', [vehicleId]);
    expect(Number(veh.odometer_reading)).toBe(1250);
    const statuses = await h.owner('select new_status from trip_status_history where trip_id = $1 order by id', [trip.id]);
    expect(statuses.map(s => s.new_status)).toEqual(['pending', 'active', 'completed']);
  });

  it('blocks drivers from editing other fields, reopening, or cancelling', async () => {
    const trip = await insertTrip();
    await expectDenied(h.as(driverId, q => q(`update trips set quantity = '9999' where id = $1`, [trip.id])));
    await expectDenied(h.as(driverId, q => q(`update trips set vehicle_id = null where id = $1`, [trip.id])));
    await expectDenied(h.as(driverId, q => q(`update trips set trip_status = 'cancelled' where id = $1`, [trip.id])));

    await h.as(driverId, q => q(`update trips set trip_status = 'completed', arrival_time = now() where id = $1`, [trip.id]));
    await expectDenied(h.as(driverId, q => q(`update trips set trip_status = 'active' where id = $1`, [trip.id])));
  });

  it("hides and protects other drivers' trips", async () => {
    const trip = await insertTrip({ driver_id: otherDriverRowId, driver_user_id: otherDriverId });
    expect(await h.as(driverId, q => q('select id from trips where id = $1', [trip.id]))).toHaveLength(0);
    const updated = await h.as(driverId, q => q(`update trips set trip_status = 'active' where id = $1 returning id`, [trip.id]));
    expect(updated).toHaveLength(0);
  });

  it('records before/after values in the audit log', async () => {
    const trip = await insertTrip();
    await h.as(managerId, q => q(`update trips set quantity = '12' where id = $1`, [trip.id]));
    const [entry] = await h.owner(
      `select actor_id, old_value->>'quantity' as old_q, new_value->>'quantity' as new_q
       from audit_logs where entity_id = $1 and action = 'update' order by id desc limit 1`,
      [trip.id]
    );
    expect(entry).toEqual({ actor_id: managerId, old_q: '10', new_q: '12' });
  });
});

describe('fuel logs', () => {
  it('lets a driver log fuel against their own trip only, and not delete logs', async () => {
    const own = await insertTrip();
    const other = await insertTrip({ driver_id: otherDriverRowId, driver_user_id: otherDriverId });
    const [log] = await h.as(driverId, q =>
      q(`insert into fuel_logs (trip_id, vehicle_id, liters, logged_by) values ($1, $2, 40, $3) returning id`, [own.id, vehicleId, driverId])
    );
    await expectDenied(h.as(driverId, q =>
      q(`insert into fuel_logs (trip_id, vehicle_id, liters, logged_by) values ($1, $2, 40, $3)`, [other.id, vehicleId, driverId])
    ));
    await expectDenied(h.as(driverId, q =>
      q(`insert into fuel_logs (trip_id, vehicle_id, liters, logged_by) values ($1, $2, 40, $3)`, [own.id, vehicleId, adminId])
    ));
    const deleted = await h.as(driverId, q => q('delete from fuel_logs where id = $1 returning id', [log.id]));
    expect(deleted).toHaveLength(0);
  });
});

describe('notifications', () => {
  it('lets the recipient mark read but not rewrite the message', async () => {
    const [n] = await h.as(managerId, q =>
      q(`insert into notifications (driver_user_id, title, body) values ($1, 'Trip', 'Go') returning id`, [driverId])
    );
    await h.as(driverId, q => q('update notifications set read = true where id = $1', [n.id]));
    await expectDenied(h.as(driverId, q => q(`update notifications set title = 'x' where id = $1`, [n.id])));
    expect(await h.as(otherDriverId, q => q('select id from notifications where id = $1', [n.id]))).toHaveLength(0);
  });
});

describe('documents', () => {
  it('restricts Aadhaar/PAN documents to admins (and the driver themselves)', async () => {
    await h.as(adminId, q => q(
      `insert into documents (entity_type, entity_id, doc_type, expiry_date) values
        ('driver', $1, 'aadhaar', null), ('driver', $1, 'license', current_date + 20)`,
      [driverRowId]
    ));
    const managerView = await h.as(managerId, q => q('select doc_type from documents where entity_id = $1', [driverRowId]));
    expect(managerView.map(d => d.doc_type)).toEqual(['license']);
    const adminView = await h.as(adminId, q => q('select doc_type from documents where entity_id = $1', [driverRowId]));
    expect(adminView).toHaveLength(2);
    const ownView = await h.as(driverId, q => q('select doc_type from documents where entity_id = $1', [driverRowId]));
    expect(ownView).toHaveLength(2);
    await expectDenied(h.as(managerId, q => q(
      `insert into documents (entity_type, entity_id, doc_type) values ('driver', $1, 'pan')`, [driverRowId]
    )));
  });
});

describe('fleet health & compliance', () => {
  it('lists expiring vehicle papers, licences, documents and maintenance due by odometer', async () => {
    await h.owner(
      `insert into vehicle_maintenance (vehicle_id, service_date, next_service_due_odometer) values ($1, current_date - 90, 1500)`,
      [vehicleId]
    );
    const alerts = await h.as(managerId, q => q('select kind, item, label from get_compliance_alerts(30)'));
    const kinds = alerts.map(a => `${a.kind}:${a.item}`);
    expect(kinds).toEqual(expect.arrayContaining([
      'vehicle_doc:insurance', 'driver_license:license', 'document:license', 'maintenance:service',
    ]));
    expect(kinds).not.toContain('document:aadhaar');
  });

  it('notifies a driver about their expiring licence once per week', async () => {
    const first = await h.as(adminId, q => q('select scan_compliance_alerts() as n'));
    const second = await h.as(adminId, q => q('select scan_compliance_alerts() as n'));
    expect(first[0].n).toBeGreaterThanOrEqual(1);
    expect(second[0].n).toBe(0);
    const notes = await h.as(driverId, q => q(`select title from notifications where type = 'doc_expiry'`));
    expect(notes).toHaveLength(1);
    await expectDenied(h.as(managerId, q => q('select scan_compliance_alerts()')));
  });
});

describe('analytics rollup', () => {
  let v2: string;
  beforeAll(async () => {
    [{ id: v2 }] = await h.owner(`insert into vehicles (registration_number) values ('RJ14XY0001') returning id`);
    const day = (n: number) => `now() - interval '${n} days'`;
    await h.owner(
      `insert into trips (departure_time, arrival_time, vehicle_id, driver_id, driver_user_id, trip_status, distance_travelled_km, fuel_filled_liters) values
        (${day(60)}, ${day(60)}, $1, $2, $3, 'completed', 300, 50),
        (${day(50)}, null,       $1, $2, $3, 'active',    100, 20),
        (${day(45)}, null,       $1, $2, $3, 'cancelled', 999, 99),
        (now(),      null,       $1, $2, $3, 'active',     40, 10)`,
      [v2, driverRowId, driverId]
    );
  });

  const totals = (rows: any[]) => rows
    .filter(r => r.vehicle_id === v2)
    .reduce((a, r) => ({ trips: a.trips + Number(r.trip_count), km: a.km + Number(r.distance_km), fuel: a.fuel + Number(r.fuel_liters) }), { trips: 0, km: 0, fuel: 0 });

  it('reads long ranges from trip_daily_stats and still matches the raw trips', async () => {
    const range = [new Date(Date.now() - 90 * 864e5).toISOString(), new Date(Date.now() + 864e5).toISOString()];
    const beforeRollup = await h.as(managerId, q => q('select * from get_trip_analytics($1, $2)', range));
    expect(totals(beforeRollup)).toEqual({ trips: 3, km: 440, fuel: 80 });

    await h.as(adminId, q => q('select refresh_dirty_trip_stats()'));
    const [{ n }] = await h.owner('select count(*)::int as n from trip_daily_stats where vehicle_id = $1', [v2]);
    expect(n).toBe(2); // 60 and 50 days ago; today's trip stays live, cancelled is excluded

    const afterRollup = await h.as(managerId, q => q('select * from get_trip_analytics($1, $2)', range));
    expect(afterRollup[0].source).toBe('rollup');
    expect(totals(afterRollup)).toEqual({ trips: 3, km: 440, fuel: 80 });

    // An edit to an already rolled-up day is reflected immediately (day is dirty again).
    await h.owner(`update trips set distance_travelled_km = 350 where vehicle_id = $1 and distance_travelled_km = 300`, [v2]);
    const afterEdit = await h.as(managerId, q => q('select * from get_trip_analytics($1, $2)', range));
    expect(totals(afterEdit).km).toBe(490);
  });

  it('reads short ranges directly from trips and scopes drivers to their own trips', async () => {
    const range = [new Date(Date.now() - 864e5).toISOString(), new Date(Date.now() + 864e5).toISOString()];
    const rows = await h.as(managerId, q => q('select * from get_trip_analytics($1, $2, null, $3)', [...range, v2]));
    expect(rows).toEqual([expect.objectContaining({ source: 'trips', trip_count: 1 })]);
    const other = await h.as(otherDriverId, q => q('select * from get_trip_analytics($1, $2)', range));
    expect(totals(other).trips).toBe(0);
  });

  it('keeps rollup tables and refresh restricted to staff/admin', async () => {
    expect(await h.as(driverId, q => q('select * from trip_daily_stats'))).toHaveLength(0);
    await expectDenied(h.as(managerId, q => q('select refresh_dirty_trip_stats()')));
  });
});

describe('delete_my_account', () => {
  it('removes the auth user and profile but keeps fleet history', async () => {
    const mail = email('leaver');
    const uid = await h.createUser(mail);
    const [{ id: rowId }] = await h.owner(
      `insert into drivers (full_name, profile_id, user_id) values ('Leaver', $1, $1) returning id`, [uid]
    );
    const trip = await insertTrip({ driver_id: rowId, driver_user_id: uid });
    await h.as(uid, q => q('select delete_my_account()'));

    expect(await h.owner('select 1 from auth.users where id = $1', [uid])).toHaveLength(0);
    expect(await h.owner('select 1 from profiles where id = $1', [uid])).toHaveLength(0);
    const [driver] = await h.owner('select profile_id from drivers where id = $1', [rowId]);
    expect(driver.profile_id).toBeNull();
    expect(await h.owner('select 1 from trips where id = $1', [trip.id])).toHaveLength(1);
  });

  it('refuses to delete the last active admin', async () => {
    const solo = await bootDatabase();
    try {
      const id = await solo.createUserWithRole('only-admin@example.com', 'admin');
      await expect(solo.as(id, q => q('select delete_my_account()'))).rejects.toThrow(/last active admin/);
    } finally {
      await solo.close();
    }
  });
});

describe('migration', () => {
  it('is safe to re-run over existing data', async () => {
    const { schemaSql } = await import('./pgHarness');
    const [{ n: before }] = await h.owner('select count(*)::int as n from trips');
    await h.db.exec(schemaSql());
    const [{ n: after }] = await h.owner('select count(*)::int as n from trips');
    expect(after).toBe(before);
    const [p] = await h.owner('select role from profiles where id = $1', [adminId]);
    expect(p.role).toBe('admin');
  });
});

describe('password reset OTPs', () => {
  it('burns a code after 5 attempts and hides the table from app users', async () => {
    const [{ id }] = await h.owner(
      `insert into password_reset_otps (email, otp_hash, expires_at) values ('x@example.com', 'h', now() + interval '10 minutes') returning id`
    );
    const results: (number | null)[] = [];
    for (let i = 0; i < 6; i++) {
      const [{ n }] = await h.owner('select register_otp_attempt($1, 5) as n', [id]);
      results.push(n);
    }
    expect(results).toEqual([1, 2, 3, 4, 5, null]);
    expect(await h.as(adminId, q => q('select * from password_reset_otps'))).toHaveLength(0);
    await expectDenied(h.as(adminId, q => q('select register_otp_attempt($1, 5)', [id])));
  });
});
