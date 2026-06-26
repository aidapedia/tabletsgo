/**
 * Comprehensive seed data for testing and development
 */

export const POSTGRES_SEED = `
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  status TEXT,
  category TEXT,
  capacity INTEGER,
  description TEXT,
  location TEXT,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

INSERT INTO events (id, name, slug, status, category, capacity, description, location, starts_at, ends_at, created_at, updated_at) VALUES
 (1,'Tech Summit 2026','tech-summit-2026','published','conference',500,'A comprehensive summit covering latest tech trends','Jakarta Convention Center','2026-08-12 09:00','2026-08-13 17:00','2026-01-04 10:21','2026-06-15 14:30'),
 (2,'Product Workshop','product-workshop','draft','workshop',80,'Hands-on workshop on product management','Tech Hub Building','2026-07-02 13:00','2026-07-02 17:00','2026-02-18 08:45','2026-06-20 09:15'),
 (3,'Annual Gala','annual-gala','published','gala',300,'Exclusive networking gala for sponsors','Grand Hotel Ballroom','2026-09-20 18:30','2026-09-21 01:00','2026-03-01 16:12','2026-06-10 11:45'),
 (4,'Dev Meetup #14','dev-meetup-14','published','meetup',120,'Monthly developer community meetup','Coffee House Downtown','2026-06-30 19:00','2026-06-30 21:30','2026-05-22 11:05','2026-06-25 08:00'),
 (5,'Onboarding Day','onboarding-day','archived','training',40,'New employee onboarding program','Office Conference Room','2026-04-10 09:30','2026-04-10 15:30','2026-01-30 09:00','2026-04-15 16:20'),
 (6,'AI Workshop Series','ai-workshop-series','published','workshop',150,'Introduction to machine learning and AI','Tech Hub Building','2026-07-15 10:00','2026-07-15 16:00','2026-05-01 13:22','2026-06-22 10:10'),
 (7,'Startup Pitch Night','startup-pitch-night','published','networking',200,'Startups pitch to investors','Venture Hub','2026-08-05 18:00','2026-08-05 21:00','2026-04-12 11:30','2026-06-18 15:45');

CREATE TABLE event_participants (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  job_title TEXT,
  status TEXT,
  checked_in INTEGER DEFAULT 0,
  check_in_time TEXT,
  dietary_restriction TEXT,
  notes TEXT,
  registered_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

INSERT INTO event_participants (id, event_id, full_name, email, phone, company, job_title, status, checked_in, check_in_time, dietary_restriction, registered_at) VALUES
 (1,1,'Aisha Rahman','aisha@example.com','+62812345001','Tech Corp','Senior Engineer','confirmed',1,'2026-08-12 08:45','vegan','2026-05-01 12:00'),
 (2,1,'Budi Santoso','budi@example.com','+62812345002','Dev Studio','Product Manager','confirmed',0,NULL,'no restriction','2026-05-02 09:14'),
 (3,1,'Clara Wijaya','clara@example.com','+62812345003','StartUp Inc','Designer','waitlist',0,NULL,'vegetarian','2026-05-03 17:40'),
 (4,1,'Dimas Pratama','dimas@example.com','+62812345004','Cloud Ventures','Lead Architect','confirmed',1,'2026-08-12 09:15','no restriction','2026-05-05 08:22'),
 (5,1,'Eka Putri','eka@example.com','+62812345005','Digital Agency','Marketing Manager','confirmed',1,'2026-08-12 08:50','no restriction','2026-05-06 14:55'),
 (6,3,'Farhan Idris','farhan@example.com','+62812345006','Finance Plus','Director','confirmed',0,NULL,'vegan','2026-05-10 10:10'),
 (7,3,'Gita Lestari','gita@example.com','+62812345007','Creative Lab','Head of Design','confirmed',0,NULL,'no restriction','2026-05-11 11:30'),
 (8,3,'Hendra Wijaya','hendra@example.com','+62812345008','Tech Solutions','CTO','confirmed',0,NULL,'gluten-free','2026-05-12 14:22'),
 (9,4,'Ira Sukmana','ira@example.com','+62812345009','Startup Lab','Founder','confirmed',1,'2026-06-30 18:50','vegan','2026-06-01 10:10'),
 (10,4,'Jaka Atmaja','jaka@example.com','+62812345010','Code Masters','Senior Developer','confirmed',1,'2026-06-30 19:05','no restriction','2026-06-02 11:30'),
 (11,6,'Karin Sulistyo','karin@example.com','+62812345011','AI Research','Researcher','confirmed',0,NULL,'vegetarian','2026-05-20 09:45'),
 (12,6,'Lenny Gunawan','lenny@example.com','+62812345012','Data Analytics','Data Scientist','confirmed',0,NULL,'no restriction','2026-05-21 14:20'),
 (13,7,'Mega Indah','mega@example.com','+62812345013','Venture Capital','Investor','confirmed',0,NULL,'no restriction','2026-06-08 16:30'),
 (14,7,'Nina Kusuma','nina@example.com','+62812345014','TechStartup','CEO','confirmed',0,NULL,'vegan','2026-06-10 11:15');

CREATE TABLE event_sessions (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  speaker TEXT,
  speaker_bio TEXT,
  room TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  duration_min INTEGER,
  capacity INTEGER,
  track TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

INSERT INTO event_sessions (id, event_id, title, description, speaker, speaker_bio, room, starts_at, ends_at, duration_min, capacity, track) VALUES
 (1,1,'Keynote: The Road Ahead','Exploring future technologies and trends','Aisha Rahman','CEO of Tech Corp','Main Hall','2026-08-12 09:30','2026-08-12 10:30',60,500,'Keynote'),
 (2,1,'Scaling Postgres','Best practices for scaling PostgreSQL databases','Budi Santoso','Database Expert','Room A','2026-08-12 11:00','2026-08-12 11:45',45,100,'Database'),
 (3,1,'Realtime with Redis','Building realtime applications with Redis','Clara Wijaya','Systems Architect','Room B','2026-08-12 11:00','2026-08-12 11:45',45,80,'Backend'),
 (4,1,'Frontend Performance','Optimizing React applications','Dimas Pratama','Performance Engineer','Room C','2026-08-12 14:00','2026-08-12 14:45',45,90,'Frontend'),
 (5,1,'Security Deep Dive','Modern security practices','Eka Putri','Security Lead','Room A','2026-08-12 15:00','2026-08-12 15:45',45,75,'Security'),
 (6,3,'Welcome Toast','Opening remarks and networking','Dimas Pratama','Event Host','Ballroom','2026-09-20 19:00','2026-09-20 19:30',30,300,'Welcome'),
 (7,4,'State of JavaScript 2026','Latest trends in JavaScript','Jaka Atmaja','Tech Blogger','Main Room','2026-06-30 19:00','2026-06-30 20:00',60,120,'Technical'),
 (8,6,'Introduction to ML','Getting started with machine learning','Karin Sulistyo','ML Engineer','Room 1','2026-07-15 10:00','2026-07-15 11:30',90,100,'AI/ML'),
 (9,6,'Neural Networks 101','Understanding deep learning','Lenny Gunawan','Data Scientist','Room 2','2026-07-15 12:00','2026-07-15 13:30',90,80,'AI/ML'),
 (10,7,'Pitch Format & Tips','How to pitch effectively','Mega Indah','VC Partner','Main Stage','2026-08-05 18:00','2026-08-05 18:30',30,200,'Workshop');

CREATE TABLE event_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  background_image_url TEXT,
  color_scheme TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);

INSERT INTO event_templates (id, name, category, description, background_image_url, color_scheme, is_active, created_at, updated_at) VALUES
 (1,'Minimal Dark','badge','Clean dark design for professional events','https://cdn.example.com/storage/file/dark.png','#1a1a1a, #ffffff',1,'2026-01-10 10:00','2026-06-01 14:20'),
 (2,'Classic Light','badge','Traditional light template for formal events','https://cdn.example.com/storage/file/light.png','#ffffff, #000000',1,'2026-01-11 10:00','2026-06-05 09:30'),
 (3,'Default Banner','banner','Standard banner layout','https://cdn.example.com/storage/file/default.png','#2563eb, #ffffff',1,'2026-01-12 10:00','2026-06-02 11:45'),
 (4,'Modern Gradient','badge','Gradient design for tech events','https://cdn.example.com/storage/file/gradient.png','#667eea, #764ba2',1,'2026-02-15 13:10','2026-06-10 16:50'),
 (5,'Minimalist','badge','Ultra-minimal design','https://cdn.example.com/storage/file/minimal.png','#f3f4f6, #111827',0,'2026-03-20 15:45','2026-04-01 08:15');

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  participant_id INTEGER NOT NULL,
  ticket_type TEXT,
  quantity INTEGER DEFAULT 1,
  amount NUMERIC NOT NULL,
  currency TEXT DEFAULT 'IDR',
  status TEXT DEFAULT 'pending',
  payment_method TEXT,
  transaction_id TEXT,
  created_at TEXT,
  paid_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (participant_id) REFERENCES event_participants(id)
);

INSERT INTO orders (id, event_id, participant_id, ticket_type, quantity, amount, currency, status, payment_method, transaction_id, created_at, paid_at) VALUES
 (1,1,1,'VIP',1,150000,'IDR','paid','qris','TXN001','2026-05-01 12:05','2026-05-01 12:15'),
 (2,1,2,'Regular',1,100000,'IDR','paid','va_bca','TXN002','2026-05-02 09:20','2026-05-02 10:45'),
 (3,1,4,'VIP',1,150000,'IDR','paid','gopay','TXN003','2026-05-05 08:30','2026-05-05 08:45'),
 (4,1,5,'Regular',1,100000,'IDR','paid','qris','TXN004','2026-05-06 15:00','2026-05-06 15:30'),
 (5,3,6,'Premium',1,500000,'IDR','paid','cc','TXN005','2026-05-10 10:12','2026-05-10 11:00'),
 (6,3,7,'Regular',1,300000,'IDR','paid','va_bca','TXN006','2026-05-11 11:15','2026-05-11 12:30'),
 (7,3,8,'Premium',1,500000,'IDR','refunded','qris','TXN007','2026-05-12 14:22','2026-05-12 15:10'),
 (8,4,9,'Regular',1,0,'IDR','free','none','TXN008','2026-06-01 10:12',NULL),
 (9,4,10,'Regular',1,0,'IDR','free','none','TXN009','2026-06-02 11:30',NULL),
 (10,6,11,'Regular',1,0,'IDR','free','none','TXN010','2026-05-20 09:45',NULL),
 (11,6,12,'Regular',1,0,'IDR','free','none','TXN011','2026-05-21 14:20',NULL),
 (12,7,13,'Regular',1,50000,'IDR','pending','qris','TXN012','2026-06-08 16:30',NULL),
 (13,7,14,'Regular',1,50000,'IDR','paid','va_bca','TXN013','2026-06-10 11:15','2026-06-10 12:45');

CREATE TABLE payment_methods (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  label TEXT NOT NULL,
  provider TEXT,
  enabled INTEGER DEFAULT 1,
  icon_url TEXT,
  description TEXT
);

INSERT INTO payment_methods (id, code, label, provider, enabled, icon_url, description) VALUES
 (1,'qris','QRIS','midtrans',1,'https://cdn.example.com/icons/qris.png','Quick Response Code for all banks'),
 (2,'va_bca','BCA Virtual Account','midtrans',1,'https://cdn.example.com/icons/bca.png','Bank Central Asia Virtual Account'),
 (3,'va_mandiri','Mandiri Virtual Account','midtrans',1,'https://cdn.example.com/icons/mandiri.png','Bank Mandiri Virtual Account'),
 (4,'gopay','GoPay','midtrans',1,'https://cdn.example.com/icons/gopay.png','GoPay digital wallet'),
 (5,'ovo','OVO','midtrans',1,'https://cdn.example.com/icons/ovo.png','OVO digital wallet'),
 (6,'cc','Credit Card','stripe',0,'https://cdn.example.com/icons/cc.png','Visa, Mastercard, American Express'),
 (7,'bank_transfer','Bank Transfer','manual',1,'https://cdn.example.com/icons/bank.png','Direct bank transfer');

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  event_id INTEGER,
  participant_id INTEGER,
  channel TEXT NOT NULL,
  type TEXT,
  subject TEXT NOT NULL,
  body TEXT,
  status TEXT DEFAULT 'pending',
  sent_at TEXT,
  opened_at TEXT,
  failed_reason TEXT,
  created_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (participant_id) REFERENCES event_participants(id)
);

INSERT INTO notifications (id, event_id, participant_id, channel, type, subject, body, status, sent_at, opened_at, created_at) VALUES
 (1,1,1,'email','confirmation','Your ticket is confirmed','Thank you for registering for Tech Summit 2026','sent','2026-05-01 12:06','2026-05-01 13:45','2026-05-01 12:00'),
 (2,1,2,'email','reminder','Event reminder: 1 day to go','Tech Summit 2026 starts tomorrow at 9:00 AM','queued',NULL,NULL,'2026-08-11 12:00'),
 (3,1,NULL,'whatsapp','broadcast','Check-in is now open','Event has started, please check in at entrance','sent','2026-08-12 08:00',NULL,'2026-08-12 07:55'),
 (4,3,6,'email','refund','Payment refunded','Your order has been refunded','failed','2026-05-06 15:01',NULL,'2026-05-06 14:55'),
 (5,1,4,'sms','reminder','Tech Summit tomorrow','Don''t miss Tech Summit 2026 tomorrow!','sent','2026-08-11 18:00',NULL,'2026-08-11 17:50'),
 (6,4,9,'email','confirmation','You''re registered for Dev Meetup','See you at Coffee House Downtown at 7 PM','sent','2026-06-01 10:15','2026-06-01 11:20','2026-06-01 10:10'),
 (7,6,11,'email','confirmation','AI Workshop registration confirmed','Join us for Introduction to ML on July 15','sent','2026-05-20 10:00','2026-05-20 11:30','2026-05-20 09:45'),
 (8,7,14,'email','confirmation','Startup Pitch Night registration','Prepare your 3-minute pitch for August 5','sent','2026-06-10 11:30','2026-06-10 13:00','2026-06-10 11:15');

CREATE TABLE attributes (
  id INTEGER PRIMARY KEY,
  event_id INTEGER,
  name TEXT NOT NULL,
  display_name TEXT,
  data_type TEXT NOT NULL,
  required INTEGER DEFAULT 0,
  options TEXT,
  placeholder TEXT,
  order_index INTEGER,
  created_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

INSERT INTO attributes (id, event_id, name, display_name, data_type, required, options, placeholder, order_index, created_at) VALUES
 (1,1,'company','Company','text',0,NULL,'PT Example Company',1,'2026-01-04 10:21'),
 (2,1,'job_title','Job Title','text',0,NULL,'Senior Manager',2,'2026-01-04 10:21'),
 (3,1,'dietary','Dietary Restriction','enum',0,'vegan,vegetarian,gluten-free,no restriction',NULL,3,'2026-01-04 10:21'),
 (4,1,'phone','Phone Number','text',1,NULL,'+62 812 3456 7890',4,'2026-01-04 10:21'),
 (5,3,'company','Company','text',1,NULL,'PT Company Name',1,'2026-03-01 16:12'),
 (6,3,'industry','Industry','enum',0,'technology,finance,retail,healthcare,other',NULL,2,'2026-03-01 16:12'),
 (7,6,'experience_level','Experience Level','enum',0,'beginner,intermediate,advanced',NULL,1,'2026-05-01 13:22'),
 (8,7,'linkedin','LinkedIn Profile','text',0,NULL,'linkedin.com/in/yourprofile',1,'2026-04-12 11:30');

CREATE TABLE analytics (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  date TEXT,
  registrations INTEGER DEFAULT 0,
  checkins INTEGER DEFAULT 0,
  cancellations INTEGER DEFAULT 0,
  refunds NUMERIC DEFAULT 0,
  revenue NUMERIC DEFAULT 0,
  updated_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

INSERT INTO analytics (id, event_id, date, registrations, checkins, cancellations, refunds, revenue, updated_at) VALUES
 (1,1,'2026-08-12',5,3,1,0,400000,'2026-08-12 17:00'),
 (2,3,'2026-09-20',3,0,0,500000,800000,'2026-09-20 22:00'),
 (3,4,'2026-06-30',2,2,0,0,0,'2026-06-30 21:00'),
 (4,6,'2026-07-15',2,0,0,0,0,'2026-07-15 16:30'),
 (5,7,'2026-08-05',2,0,1,0,50000,'2026-08-05 21:30');
`;

export const REDIS_SEED = `
CREATE TABLE keys (
  key TEXT PRIMARY KEY,
  type TEXT,
  ttl INTEGER,
  value TEXT,
  size_bytes INTEGER,
  created_at TEXT,
  last_accessed TEXT
);

INSERT INTO keys VALUES
 ('session:a1b2c3','string',3600,'{\"userId\":42,\"role\":\"admin\",\"name\":\"Aisha Rahman\"}',120,'2026-06-26 08:00','2026-06-26 14:30'),
 ('session:d4e5f6','string',3600,'{\"userId\":7,\"role\":\"member\",\"name\":\"Budi Santoso\"}',115,'2026-06-26 08:15','2026-06-26 14:25'),
 ('session:g7h8i9','string',3600,'{\"userId\":13,\"role\":\"moderator\",\"name\":\"Clara Wijaya\"}',125,'2026-06-26 09:00','2026-06-26 14:20'),
 ('cache:events:list','string',300,'[1,2,3,4,5,6,7]',18,'2026-06-26 14:20','2026-06-26 14:30'),
 ('cache:user:42:profile','string',600,'{\"name\":\"Aisha Rahman\",\"email\":\"aisha@example.com\",\"role\":\"admin\"}',95,'2026-06-26 13:50','2026-06-26 14:25'),
 ('rate:login:42','string',60,'5',1,'2026-06-26 14:25','2026-06-26 14:29'),
 ('rate:api:user:7','string',60,'23',2,'2026-06-26 14:20','2026-06-26 14:28'),
 ('queue:emails','list',-1,'[\"welcome:42\",\"reminder:7\",\"confirmation:13\",\"notification:88\"]',85,'2026-06-01 10:00','2026-06-26 12:00'),
 ('queue:sms','list',-1,'[\"otp:42\",\"reminder:7\"]',30,'2026-06-01 10:00','2026-06-26 12:15'),
 ('leaderboard:month','zset',-1,'aisha=980, budi=920, clara=870, dimas=750, eka=680',110,'2026-06-01 00:00','2026-06-26 14:30'),
 ('online:users','set',-1,'42, 7, 13, 88, 99',15,'2026-06-26 14:00','2026-06-26 14:29'),
 ('online:users:count','string',-1,'5',1,'2026-06-26 14:00','2026-06-26 14:29'),
 ('feature:flags','hash',-1,'{\"new_checkout\":\"on\",\"dark_mode\":\"on\",\"beta_search\":\"off\",\"ai_suggestions\":\"on\"}',110,'2026-01-01 00:00','2026-06-26 14:30'),
 ('config:app:version','string',-1,'1.2.5',5,'2026-05-01 10:00','2026-06-26 14:30'),
 ('config:app:maintenance','string',-1,'false',5,'2026-06-26 00:00','2026-06-26 08:00'),
 ('pubsub:notifications','string',-1,'active',6,'2026-06-26 08:00','2026-06-26 14:30');

CREATE TABLE info (
  metric TEXT PRIMARY KEY,
  value TEXT,
  description TEXT
);

INSERT INTO info VALUES
 ('redis_version','7.2.4','Redis server version'),
 ('redis_mode','standalone','Running mode'),
 ('connected_clients','12','Number of connected clients'),
 ('used_memory_human','3.41M','Memory usage'),
 ('used_memory_rss_human','5.20M','RSS memory usage'),
 ('total_keys','16','Total number of keys'),
 ('uptime_days','27','Days since server started'),
 ('uptime_seconds','2332800','Seconds since server started'),
 ('commands_processed','45832','Total commands processed'),
 ('ops_per_sec','18.5','Operations per second');
`;
