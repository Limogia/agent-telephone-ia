/* ===== DETECT ACTION ROBUSTE ===== */

const actionMatch = reply.match(
  /(CREATE|DELETE|CHECK)\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})|UPDATE\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})/
);

if (actionMatch) {

  const fullMatch = actionMatch[0];
  const parts = fullMatch.split("|");
  const action = parts[0];

  /* ===== CREATE ===== */
  if (action === "CREATE") {
    const date = parts[1];
    const time = parts[2];

    const start = new Date(`${date}T${time}:00`);

    await calendar.events.insert({
      calendarId: "primary",
      resource: {
        summary: "Rendez-vous client",
        start: { dateTime: start.toISOString(), timeZone: "Europe/Paris" },
        end: {
          dateTime: new Date(start.getTime() + 3600000).toISOString(),
          timeZone: "Europe/Paris",
        },
      },
    });

    reply = reply.replace(fullMatch, "Votre rendez-vous est confirmé.");
  }

  /* ===== DELETE ===== */
  if (action === "DELETE") {
    const date = parts[1];
    const time = parts[2];

    const start = new Date(`${date}T${time}:00`);

    const events = await calendar.events.list({
      calendarId: "primary",
      timeMin: start.toISOString(),
      timeMax: new Date(start.getTime() + 3600000).toISOString(),
    });

    if (events.data.items.length > 0) {
      await calendar.events.delete({
        calendarId: "primary",
        eventId: events.data.items[0].id,
      });

      reply = reply.replace(fullMatch, "Le rendez-vous a été supprimé.");
    } else {
      reply = "Je n'ai trouvé aucun rendez-vous à cette heure.";
    }
  }

  /* ===== UPDATE ===== */
  if (action === "UPDATE") {
    const oldDate = parts[1];
    const oldTime = parts[2];
    const newDate = parts[3];
    const newTime = parts[4];

    const oldStart = new Date(`${oldDate}T${oldTime}:00`);

    const events = await calendar.events.list({
      calendarId: "primary",
      timeMin: oldStart.toISOString(),
      timeMax: new Date(oldStart.getTime() + 3600000).toISOString(),
    });

    if (events.data.items.length > 0) {
      const event = events.data.items[0];
      const newStart = new Date(`${newDate}T${newTime}:00`);

      await calendar.events.update({
        calendarId: "primary",
        eventId: event.id,
        resource: {
          summary: event.summary,
          start: {
            dateTime: newStart.toISOString(),
            timeZone: "Europe/Paris",
          },
          end: {
            dateTime: new Date(newStart.getTime() + 3600000).toISOString(),
            timeZone: "Europe/Paris",
          },
        },
      });

      reply = reply.replace(fullMatch, "Le rendez-vous a été modifié.");
    } else {
      reply = "Je n'ai trouvé aucun rendez-vous correspondant.";
    }
  }

  /* ===== CHECK ===== */
  if (action === "CHECK") {
    const date = parts[1];
    const time = parts[2];

    const start = new Date(`${date}T${time}:00`);

    const events = await calendar.events.list({
      calendarId: "primary",
      timeMin: start.toISOString(),
      timeMax: new Date(start.getTime() + 3600000).toISOString(),
    });

    if (events.data.items.length > 0) {
      reply = reply.replace(fullMatch, "Ce créneau est déjà pris.");
    } else {
      reply = reply.replace(fullMatch, "Ce créneau est disponible.");
    }
  }
}
