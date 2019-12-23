/**
 * ICS Builders
**/
//TODO: finish bringing this up to es5/6 standard
const crypto = require('crypto'),
      moment = require('moment'),
      path   = require('path');

function _transformRepeating(repeating) {
  const transformed = {}

  transformed.freq = repeating['FREQ'] || 'DAILY';
  if (repeating['BYDAY'])    { transformed.byday    = repeating['BYDAY'].split(',');       }
  if (repeating['BYMONTH'])  { transformed.bymonth  = repeating['BYMONTH'].split(',');     }
  if (repeating['COUNT'])    { transformed.count    = repeating['COUNT'] | 0;              }
  if (repeating['INTERVAL']) { transformed.interval = repeating['INTERVAL'] | 0;           }
  if (repeating['UNTIL'])    { transformed.until    = moment(repeating['UNTIL']).toDate(); }

  return transformed;
}

function _transformParticipant(participant) {
  const transformed = {};
  const asis = {
    'CN':       'name',
    'PARTSTAT': 'status',
    'ROLE':     'role',
    'RSVP':     'rsvp',
  }

  for(const key in asis) {
    const transformedKey = asis[key];
    if (participant[key]) { transformed[transformedKey] = participant[key]; }
  }
  return transformed;
}

function _transformRecurrenceRules(vEvent) {
  const transformed = {};
  if (vEvent['RRULE']) {
    const repeat = vEvent['RRULE'];
    const checks = repeat.split(';');
    const repeating = {};

    for (const i in checks) {
      const keyVal = checks[i].split('=');
      repeating[keyVal[0]] = keyVal[1];
    }
    transformed.repeating = _transformRepeating(repeating);
  }
  delete vEvent['RRULE'];
  return transformed;
}

function _transformBareKeysEvent(vEvent) {
  const transformed = {};
  const asis = {
    'CLASS':         'class',
    'CREATED':       'created',
    'DESCRIPTION':   'description',
    'DTEND':         'end',
    'DTSTAMP':       'dtStamp',
    'DTSTART':       'start',
    'LAST-MODIFIED': 'lastModified',
    'LOCATION':      'location',
    'SEQUENCE':      'sequence',
    'STATUS':        'status',
    'SUMMARY':       'summary',
    'TRANSP':        'transp',
    'UID':           'uid',
    'DTSTART;VALUE=DATE': 'start',
    'DTEND;VALUE=DATE': 'end',
  }

  if(vEvent['DTSTART;VALUE=DATE'] && vEvent['DTEND;VALUE=DATE']) {
    transformed.onlyDate = true
  }

  for (const key in asis) {
    const transformedKey = asis[key];
    if (vEvent[key]) {
      transformed[transformedKey] = vEvent[key];
      delete vEvent[key];
    }
  }

  transformed.created      = moment(transformed.created).toDate();
  transformed.lastModified = moment(transformed.lastModified).toDate();
  transformed.sequence     = parseInt(transformed.sequence, 10);
  transformed.dtStamp      = moment(transformed.dtStamp).toDate();
  return transformed;
}

function _transformEvent(vEvent) {
  const transformed = _transformBareKeysEvent(vEvent);
  const keys = Object.keys(vEvent);

  if (transformed && transformed.start) {
    transformed.start   = moment(transformed.start).toDate();
  } else {
    const vStartKey = keys.find( el => { if (el.includes('DTSTART') && el.includes('TZID')) { return el } });

    let vStartPair = vStartKey+':'+vEvent[vStartKey], tzid, tStart;
    if(vStartPair.match(/\"([^"]+)\"/g)) {
      tzid = vStartPair.match(/\"([^"]+)\"/g)[0].slice(1, -1)
      tStart = vStartPair.split(';TZID=')[1].split(tzid+'":')[1]
    }
    Object.assign(transformed, {
      start: {
        tzid: tzid || vStartKey.split(';TZID=')[1],
        value: tStart || vEvent[vStartKey],
      }
    });
    delete vEvent[vStartKey];
  }
  if (transformed && transformed.end) {
    transformed.end     = moment(transformed.end).toDate();
  } else {
    const vEndKey = keys.find( el => { if (el.includes('DTEND') && el.includes('TZID')) { return el } });
    let vEndPair = vEndKey+':'+vEvent[vEndKey], tzid, tEnd;
    if(vEndPair.match(/\"([^"]+)\"/g)) {
      tzid = vEndPair.match(/\"([^"]+)\"/g)[0].slice(1, -1)
      tEnd = vEndPair.split(';TZID=')[1].split(tzid+'":')[1]
    }
    Object.assign(transformed, {
      end: {
        tzid: vEndKey.split(';TZID=')[1],
        value: tEnd || vEvent[vEndKey],
      }
    });
    delete vEvent[vEndKey];
  }

  // TODO: Transform alarms
  if (transformed.start.length < 11 && transformed.end.length < 11) {
    // If only date, it is an all day event
    transformed.allDay = true;
  } else {
    transformed.allDay = false;
  }

  Object.assign(transformed, _transformRecurrenceRules(vEvent));

  transformed.attendees = [];
  for(const key in vEvent) {
    const checks = key.split(';');
    const checkKey = checks.shift();

    if (checkKey === 'ORGANIZER') {
      const organizer = {};
      for(const i in checks) {
        const keyVal = checks[i].split('=');
        organizer[keyVal[0]] = keyVal[1];
      }
      transformed.organizer       = _transformParticipant(organizer);
      transformed.organizer.email = (vEvent[key] + '').toLowerCase().replace('mailto:', '');
      delete vEvent[key];
    } else if (checkKey === 'ATTENDEE') {
      const attendee = {};
      for(const i in checks) {
        const keyVal = checks[i].split('=');
        attendee[keyVal[0]] = keyVal[1];
      }

      const atn = _transformParticipant(attendee);
      atn.email = (vEvent[key] + '').toLowerCase().replace('mailto:', '');
      transformed.attendees.push(atn);
      delete vEvent[key];
    }
    // TODO: else if (checkKey === 'VALARM') {  }
  }
  transformed.additionalTags = vEvent;
  return transformed;
}

function transformCalendar(json) {
  var calendar = (json.VCALENDAR && json.VCALENDAR[0]) || {};
  const asis = {
    'VERSION':       'version',
    'CALSCALE':      'calscale',
    'X-WR-CALNAME':  'calname',
    'METHOD':        'method',
    'PRODID':        'prodid',
    'X-WR-TIMEZONE': 'wrTimezone',
  }

  var transformed = { events: [] };

  for(var key in asis) {
    var transformedKey = asis[key];
    if (calendar[key]) {
      transformed[transformedKey] = calendar[key];
      delete calendar[key];
    }
  }

  if (calendar.VTIMEZONE) {
    // Convert VTIMEZONE to tzid
    const vTimeZone      = calendar['VTIMEZONE'][0];

    transformed.timezone = { tzid: vTimeZone.TZID };
    const standard       = vTimeZone.STANDARD;
    const daylight       = vTimeZone.DAYLIGHT;
    if (standard && standard[0]) {
      Object.assign(transformed.timezone, { standard: { tzname: standard[0].TZNAME, offset: standard[0].TZOFFSETFROM }});
    }
    if (daylight && daylight[0]) {
      Object.assign(transformed.timezone, { daylight: { tzname: daylight[0].TZNAME, offset: daylight[0].TZOFFSETFROM }});
    }
    delete calendar['VTIMEZONE'];
  }

  if(calendar['VEVENT'] || json['VEVENT']) {
    var vEvents = calendar['VEVENT'] || json['VEVENT'];

    transformed.events = vEvents.map( event => { return _transformEvent(event) });
    delete calendar['VEVENT'];
  }
  transformed.additionalTags = calendar;
  return transformed;
}

/**
 * Export builder
**/
exports.transform = transformCalendar;

