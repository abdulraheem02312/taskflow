// Fills the database with dummy data for testing: teammates, projects, tasks,
// tags, comments, goals, a portfolio and inbox notifications.
// Usage: node seed.js [your-email]   (run again = skipped, demo data already there)
// Demo teammates log in with their email and the password below.
import db, { transaction } from './db.js';
import { hashPassword } from './auth.js';

const DEMO_PASSWORD = 'demo1234';
const ownerEmail = process.argv[2] || 'abdulraheem02312@gmail.com';

const owner = await db.prepare('SELECT id, name FROM users WHERE email = ?').get(ownerEmail);
if (!owner) {
  console.log(`No user with email ${ownerEmail}. Sign up first, then run this again.`);
  process.exit(1);
}
if (await db.prepare("SELECT 1 FROM users WHERE email LIKE '%@demo.test'").get()) {
  console.log('Demo data is already there, nothing to do.');
  process.exit(0);
}

// Dates relative to today, so "due soon" and "overdue" always make sense
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);

const run = async (sql, ...args) => Number((await db.prepare(sql).run(...args)).lastInsertRowid);

await transaction(async () => {
  // ---------- Teammates ----------
  const hash = hashPassword(DEMO_PASSWORD);
  const people = {};
  for (const [key, name] of [['sara', 'Sara Khan'], ['ali', 'Ali Ahmed'], ['hina', 'Hina Malik'], ['usman', 'Usman Tariq']]) {
    people[key] = await run('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      name, `${key}@demo.test`, hash, ago(30));
  }
  const me = owner.id;
  const { sara, ali, hina, usman } = people;

  // ---------- Tags ----------
  const tags = {};
  for (const [name, color] of [['design', '#f472b6'], ['bug', '#f87171'], ['frontend', '#60a5fa'], ['backend', '#a78bfa'], ['urgent', '#fb923c'], ['content', '#34d399']]) {
    const existing = await db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(me, name);
    tags[name] = existing ? existing.id : await run('INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)', me, name, color);
  }

  // ---------- Projects ----------
  // tasks: [title, section index, assignee, priority, due offset, start offset, done, tags, notes, subtasks]
  const projects = [
    {
      name: 'Website Redesign', color: '#f06a6a', status: 'on_track', due: 25,
      members: [sara, ali, hina],
      sections: ['To do', 'Doing', 'Review', 'Done'],
      update: ['on_track', 'Homepage and pricing page are designed. Dev starts this week.'],
      tasks: [
        ['Design new homepage hero', 3, sara, 'high', -6, -12, true, ['design'], 'Big headline, one button, product screenshot.', ['Sketch 3 ideas', 'Pick one with team', 'Final in Figma']],
        ['Pricing page layout', 3, sara, 'medium', -3, -7, true, ['design'], '', []],
        ['Build navbar component', 1, ali, 'high', 2, -2, false, ['frontend'], 'Must work on mobile too. Sticky on scroll.', ['Desktop version', 'Mobile menu', 'Sticky behavior']],
        ['Make site responsive on phones', 1, me, 'high', 4, -1, false, ['frontend'], '', ['Check 375px width', 'Fix images overflowing']],
        ['Write About page copy', 0, hina, 'low', 9, null, false, ['content'], '', []],
        ['Fix footer links going to 404', 2, ali, 'medium', -1, null, false, ['bug', 'frontend'], 'Privacy and Terms links are broken.', []],
        ['Compress all images', 0, me, 'medium', 6, null, false, ['frontend'], 'Use WebP, keep under 200 KB each.', []],
        ['Add contact form', 0, ali, 'medium', 12, 8, false, ['frontend', 'backend'], '', ['Form UI', 'Send email on submit', 'Spam check']],
        ['Final review with client', 0, me, 'high', 22, 22, false, [], '', []],
      ],
    },
    {
      name: 'Mobile App Launch', color: '#60a5fa', status: 'at_risk', due: 40,
      members: [usman, ali],
      sections: ['Backlog', 'In progress', 'Testing', 'Done'],
      update: ['at_risk', 'Login bug on Android is slowing us down. Might slip one week.'],
      tasks: [
        ['Set up push notifications', 1, usman, 'high', 3, -4, false, ['backend'], '', ['Firebase setup', 'Test on Android', 'Test on iPhone']],
        ['Login crashes on Android 12', 2, usman, 'high', -2, null, false, ['bug', 'urgent'], 'Happens after Google sign in. Logs attached in chat.', []],
        ['App store screenshots', 0, me, 'medium', 15, null, false, ['design'], '', []],
        ['Onboarding screens', 3, ali, 'medium', -8, -15, true, ['design', 'frontend'], '', []],
        ['Dark mode support', 0, ali, 'low', 30, 20, false, ['frontend'], '', []],
        ['Beta testing with 20 users', 0, me, 'high', 25, 18, false, [], 'Collect feedback in a Google Form.', []],
        ['Offline mode for tasks', 1, usman, 'medium', 10, 0, false, ['backend'], '', []],
      ],
    },
    {
      name: 'Marketing Plan Q4', color: '#4ade80', status: 'on_track', due: 60,
      members: [hina, sara],
      sections: ['Ideas', 'This week', 'Done'],
      update: ['on_track', 'Instagram posts are scheduled for the month.'],
      tasks: [
        ['Instagram post schedule', 2, hina, 'medium', -4, -10, true, ['content'], '', []],
        ['Write 3 blog posts', 1, hina, 'medium', 5, 0, false, ['content'], '', ['Post 1: Getting started', 'Post 2: Tips for teams', 'Post 3: Case study']],
        ['Design YouTube thumbnail template', 1, sara, 'low', 3, null, false, ['design'], '', []],
        ['Email newsletter for November', 0, me, 'medium', 14, null, false, ['content'], '', []],
        ['Run giveaway contest', 0, hina, 'low', 35, 28, false, [], '', []],
        ['Weekly analytics report', 1, me, 'low', 1, null, false, [], 'Every Friday.', [], 'weekly'],
      ],
    },
    {
      name: 'School Study Plan', color: '#fbbf24', status: null, due: null,
      members: [],
      sections: ['To do', 'Doing', 'Done'],
      update: null,
      tasks: [
        ['Maths chapter 4 exercises', 1, me, 'high', 1, null, false, ['urgent'], '', ['Ex 4.1', 'Ex 4.2', 'Ex 4.3']],
        ['Physics notes revision', 0, me, 'medium', 3, null, false, [], '', []],
        ['English essay: My Hobby', 2, me, 'medium', -2, null, true, [], '', []],
        ['Computer practical file', 0, me, 'high', 7, null, false, [], '', []],
        ['Read 20 pages daily', 1, me, 'low', 0, null, false, [], '', [], 'daily'],
      ],
    },
  ];

  const projectIds = {};
  const allTasks = []; // [taskId, projectId, assignee]
  for (const p of projects) {
    const pid = await run('INSERT INTO projects (user_id, name, color, status, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      me, p.name, p.color, p.status, p.due === null ? null : day(p.due), ago(20));
    projectIds[p.name] = pid;
    await run("INSERT INTO project_members (project_id, user_id, role, favorite) VALUES (?, ?, 'owner', ?)", pid, me, p.name === 'Website Redesign' ? 1 : 0);
    for (const uid of p.members) await run("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')", pid, uid);

    const sectionIds = [];
    for (const [i, name] of p.sections.entries()) sectionIds.push(await run('INSERT INTO sections (project_id, name, position) VALUES (?, ?, ?)', pid, name, i));
    const positions = sectionIds.map(() => 0);

    for (const [title, s, assignee, priority, due, start, done, tagNames, notes, subtasks, repeat = null] of p.tasks) {
      const tid = await run(`INSERT INTO tasks (project_id, section_id, position, title, notes, due_date, start_date, priority,
          completed, completed_at, assignee_id, assigned_by, repeat, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        pid, sectionIds[s], positions[s]++, title, notes, day(due), start === null ? null : day(start), priority,
        done ? 1 : 0, done ? new Date(Date.now() - Math.floor(Math.random() * 5) * 86400000).toISOString() : null,
        assignee, me, repeat, ago(15));
      allTasks.push([tid, pid, assignee, title]);
      for (const t of tagNames) await run('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)', tid, tags[t]);
      for (const [i, st] of subtasks.entries()) await run('INSERT INTO subtasks (task_id, title, completed, position) VALUES (?, ?, ?, ?)', tid, st, done || i === 0 ? 1 : 0, i);
    }

    if (p.update) {
      await run('INSERT INTO status_updates (project_id, user_id, status, body, created_at) VALUES (?, ?, ?, ?, ?)', pid, me, p.update[0], p.update[1], ago(2));
    }
  }

  // ---------- Comments and likes ----------
  const comments = [
    [sara, 'I uploaded the new version, please check.'],
    [ali, 'Working on this today, should be done by evening.'],
    [me, 'Looks good! Just make the button a bit bigger.'],
    [usman, 'Found the cause, it is the token refresh. Fixing now.'],
    [hina, 'Can we push this to next week?'],
  ];
  for (const [i, [tid]] of allTasks.slice(0, 15).entries()) {
    const [uid, body] = comments[i % comments.length];
    const cid = await run('INSERT INTO comments (task_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', tid, uid, body, ago(i % 4));
    if (i % 3 === 0) await run("INSERT INTO likes (kind, item_id, user_id) VALUES ('comment', ?, ?)", cid, me);
  }

  // A task can't start until another one is done
  const byTitle = (t) => allTasks.find((x) => x[3] === t)[0];
  await run('INSERT INTO task_dependencies (task_id, blocked_by_id) VALUES (?, ?)', byTitle('Final review with client'), byTitle('Make site responsive on phones'));
  await run('INSERT INTO task_dependencies (task_id, blocked_by_id) VALUES (?, ?)', byTitle('Beta testing with 20 users'), byTitle('Login crashes on Android 12'));

  // ---------- Inbox ----------
  const notes = [
    [sara, 'comment', 'Website Redesign', 'Design new homepage hero', 'I uploaded the new version, please check.', null],
    [ali, 'assigned', 'Website Redesign', 'Make site responsive on phones', null, null],
    [usman, 'mention', 'Mobile App Launch', 'Login crashes on Android 12', '@abdul can you test this on your phone?', null],
    [hina, 'status', 'Marketing Plan Q4', null, 'On track: Instagram posts are scheduled for the month.', ago(1)],
    [sara, 'completed', 'Website Redesign', 'Pricing page layout', null, ago(1)],
    [usman, 'added', 'Mobile App Launch', null, null, ago(3)],
  ];
  for (const [i, [actor, type, project, task, body, readAt]] of notes.entries()) {
    await run('INSERT INTO notifications (user_id, actor_id, type, project_id, task_id, body, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      me, actor, type, projectIds[project], task ? byTitle(task) : null, body, readAt, ago(i * 0.3));
  }

  // ---------- Goals ----------
  const g1 = await run('INSERT INTO goals (user_id, title, notes, due_date, status, progress) VALUES (?, ?, ?, ?, ?, ?)',
    me, 'Launch new website by December', 'New design, faster site, contact form working.', day(45), 'on_track', 0);
  await run('INSERT INTO goal_projects (goal_id, project_id) VALUES (?, ?)', g1, projectIds['Website Redesign']);
  const g2 = await run('INSERT INTO goals (user_id, title, notes, due_date, status, progress) VALUES (?, ?, ?, ?, ?, ?)',
    me, 'Get 1,000 app downloads', '', day(90), 'at_risk', 0);
  await run('INSERT INTO goal_projects (goal_id, project_id) VALUES (?, ?)', g2, projectIds['Mobile App Launch']);
  await run('INSERT INTO goals (user_id, title, notes, due_date, status, progress) VALUES (?, ?, ?, ?, ?, ?)',
    me, 'Score 90% in final exams', 'Study 2 hours every day.', day(120), 'on_track', 35);

  // ---------- Portfolio ----------
  const pf = await run('INSERT INTO portfolios (user_id, name, color) VALUES (?, ?, ?)', me, 'Client Work', '#a78bfa');
  for (const name of ['Website Redesign', 'Mobile App Launch', 'Marketing Plan Q4']) {
    await run('INSERT INTO portfolio_projects (portfolio_id, project_id) VALUES (?, ?)', pf, projectIds[name]);
  }

  console.log(`Done. Added 4 teammates, ${projects.length} projects and ${allTasks.length} tasks for ${owner.name}.`);
  console.log(`Teammates log in as sara/ali/hina/usman@demo.test with password ${DEMO_PASSWORD}`);
});
await db.pool.end();
