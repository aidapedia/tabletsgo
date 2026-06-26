# TabletGo - Real Database Management UI

A modern, dark-themed database management tool with support for SQLite and PostgreSQL. Built with React and Vite.

## 🎯 Features

- ✅ **Real Database Connections** - Connect to actual SQLite and PostgreSQL databases
- 📊 **Live Data Browser** - Browse tables and data with real-time API calls
- 🔍 **SQL Query Editor** - Write and execute queries with instant results
- 🗂️ **Connection Management** - Save and organize multiple database connections
- 🎨 **Dark Theme** - Optimized dark UI with green accent colors
- 📱 **Responsive Design** - Works on desktop with compact, efficient layout

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Create demo database
node scripts/create-demo-db.js
```

### Running the App

```bash
# Option 1: Run both frontend and backend together
npm run dev:all

# Option 2: Run frontend only (if backend is running separately)
npm run dev

# Option 3: Run backend server only
npm run server
```

The frontend will be available at **http://localhost:5173**  
The backend will run on **http://localhost:3000**

## 📁 Project Structure

```
tabletsgo/
├── src/                          # React frontend
│   ├── components/
│   │   ├── ConnectionModal.jsx   # Connection creation/editing
│   │   └── workspace/
│   │       ├── TableView.jsx     # Data browser
│   │       ├── QueryEditor.jsx   # SQL editor
│   │       └── DataGrid.jsx      # Results table
│   ├── context/
│   │   ├── AuthContext.jsx       # User authentication
│   │   └── ConnectionsContext.jsx # Connection management
│   ├── db/
│   │   └── sqlite.js             # API layer for database operations
│   ├── pages/
│   │   ├── Login.jsx
│   │   ├── Connections.jsx       # Connection list
│   │   └── Workspace.jsx         # Main database workspace
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css                 # Styling
├── scripts/
│   └── create-demo-db.js         # Database generator script
├── server.js                     # Express backend
├── demo.db                       # Sample SQLite database
├── package.json
├── vite.config.js
└── index.html
```

## 🗄️ Database Support

### SQLite
- File-based database
- Perfect for local development and demos
- Use relative or absolute file paths
- Example: `./demo.db` or `/path/to/database.db`

### PostgreSQL
- Network-based relational database
- Supports authentication with username/password
- Configure host, port, username, password, and database name
- Ideal for production databases

## 🔧 Backend API

The Express backend provides these endpoints:

### Connections
- `GET /api/connections` - List all connections
- `POST /api/connections` - Create new connection
- `PUT /api/connections/:id` - Update connection
- `DELETE /api/connections/:id` - Delete connection
- `POST /api/test-connection` - Test connection validity

### Database Operations
- `GET /api/connections/:id/tables` - List tables
- `GET /api/connections/:id/table/:table` - Get table data
- `POST /api/connections/:id/query` - Execute SQL query

## 📊 Sample Data

The `demo.db` includes sample event management data:

**Tables:**
- `events` - 7 sample events
- `event_participants` - 14 attendees
- `event_sessions` - 10 scheduled sessions
- `orders` - 13 ticket orders
- `payment_methods` - 7 payment options
- `notifications` - 8 notification records
- `event_templates` - 5 badge/banner templates
- `attributes` - 8 custom form fields
- `analytics` - 5 analytics records

**Try these queries:**
```sql
SELECT * FROM events;
SELECT full_name, email, status FROM event_participants;
SELECT * FROM orders WHERE status = 'paid';
SELECT event_id, COUNT(*) as participant_count FROM event_participants GROUP BY event_id;
```

## 🎨 Customization

### Adding a New Connection

1. Click **"New"** on the Connections page
2. Select **SQLite** or **PostgreSQL**
3. Fill in connection details
4. Click **"Test Connection"** to verify
5. Click **"Create Connection"**

### Font Sizes

All font sizes have been optimized for compact display. To adjust globally, edit the CSS selectors in `src/index.css`.

## 🔐 Security Notes

- Passwords are transmitted to the backend but not stored
- Use environment variables for sensitive credentials
- Never commit database files or sensitive configs to git
- Test connections verify access but don't persist sensitive data

## 🐛 Troubleshooting

### Backend not connecting
- Ensure server is running: `npm run server`
- Check if port 3000 is available
- Frontend should be served from same origin for CORS to work properly

### SQLite file not found
- Use relative paths like `./demo.db` for files in project root
- Use absolute paths for files elsewhere
- Ensure file has read/write permissions

### PostgreSQL connection fails
- Verify host, port, username, password
- Ensure database exists and user has access
- Check if PostgreSQL server is running
- Use `psql` command line to test credentials first

## 📚 Technologies

- **Frontend**: React 18, React Router, Vite
- **Backend**: Express.js, better-sqlite3, node-postgres
- **Styling**: CSS Grid, CSS Custom Properties
- **Database**: SQLite, PostgreSQL

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Feel free to fork and submit PRs.

---

**Created with ❤️ for database enthusiasts**
