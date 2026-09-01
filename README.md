# LeamJobs Job Portal - Backend API

A professional Node.js/Express backend for the LeamJobs job portal platform.

## Tech Stack

- **Runtime**: Node.js 22.x
- **Framework**: Express.js
- **Database**: PostgreSQL 10.23
- **ORM**: Prisma
- **Authentication**: JWT with bcrypt
- **Validation**: Zod
- **Security**: Helmet, CORS, express-rate-limit
- **Email**: Nodemailer
- **Task Scheduling**: node-cron
- **Testing**: Jest & Supertest

## Project Structure

```
src/
  ├── server.js           # Entry point
  ├── app.js              # Express app configuration
  ├── config/             # Configuration files
  │   ├── env.js          # Environment variables
  │   └── database.js     # Database connection
  ├── routes/             # API routes
  ├── controllers/        # Request handlers
  ├── services/           # Business logic
  ├── middleware/         # Express middleware
  ├── utils/              # Utility functions
  └── validators/         # Zod validation schemas
prisma/
  └── schema.prisma       # Database schema
tests/                    # Test files
```

## Setup Instructions

### Prerequisites

- Node.js 22.x
- PostgreSQL 10.23
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd job-portal-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   npm install -D  # Install dev dependencies
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Initialize Prisma**
   ```bash
   npm run prisma:generate
   npm run prisma:migrate:dev
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:5000` by default.

## Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with hot reload
- `npm test` - Run test suite
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate:dev` - Create and apply database migrations
- `npm run prisma:studio` - Open Prisma Studio

## Environment Variables

See `.env.example` for all available configuration options.

Key variables:
- `NODE_ENV` - Environment (development, production)
- `PORT` - Server port
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT signing secret
- `FRONTEND_URL` - Frontend origin for CORS

## API Documentation

API endpoints will be documented as they are implemented.

## Database

### Current Schema

- **User** - User accounts with UUID primary key, supporting multiple roles (SEEKER, EMPLOYER, ADMIN)

### Running Migrations

```bash
# Create a new migration
npm run prisma:migrate:dev

# Apply migrations to production
npm run prisma:migrate:deploy

# View database in Prisma Studio
npm run prisma:studio
```

## Security

- All passwords are hashed using bcrypt
- JWT tokens used for authentication
- Security headers enforced with Helmet
- CORS configured for specific frontend origins
- Rate limiting applied to prevent abuse
- Input validation with Zod

## Deployment

### Production Hosting: Namecheap Stellar Business

1. Set `NODE_ENV=production`
2. Configure `DATABASE_URL` for production PostgreSQL
3. Update `FRONTEND_URL_PROD` with production domain
4. Generate strong `JWT_SECRET`
5. Configure SMTP for production email service
6. Deploy using appropriate Node.js hosting configuration

## Testing

```bash
npm test
```

## Contributing

Follow the project structure and coding conventions. All code must pass tests before merging.

## License

ISC
