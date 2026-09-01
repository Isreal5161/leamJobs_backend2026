LEAMJOBS BACKEND ARCHITECTURE — NODE.JS VERSION
1. PROJECT OVERVIEW

LeamJobs is a job portal connecting job seekers with employers.

The platform will allow:

Job seekers to register and create profiles.
Employers to register and create company profiles.
Employers to post job vacancies.
Administrators to review and approve/reject job postings.
Only approved jobs to appear publicly.
Job seekers to search and filter jobs.
Job seekers to apply for jobs.
Job seekers to save/bookmark jobs.
Job seekers to subscribe to available subscription plans.
Subscription payments through Flutterwave.
Backend verification of all payments.
Administrators to manage users, employers, jobs, applications, subscriptions and payments.
Audit logs and security records.

The backend will prioritize:

Security
Maintainability
Performance
Database integrity
Scalability
Easy deployment to Namecheap
Easy future migration to VPS/cloud
2. CURRENT PRODUCTION ENVIRONMENT
Hosting

Namecheap Stellar Business Shared Hosting

Backend

Node.js

Express.js

Runtime

Recommended:

Node.js 20 LTS or Node.js 22 LTS

We will choose the version actually available in your cPanel and use that consistently for development and production.

Namecheap currently lists Node.js 20, 22 and 24 among the available shared-hosting versions.

Database

PostgreSQL 10.23

This matches your existing Namecheap database.

Authentication
UUID
JWT
bcrypt or another secure password-hashing library
Refresh-token strategy
Payment

Flutterwave

Frontend

Existing LeamJobs frontend hosted separately on Vercel.

Scheduled Tasks

Namecheap Cron Jobs.

SSL

HTTPS/SSL.

3. HOSTING LIMITATIONS

The initial architecture must work within Namecheap shared hosting.

We will therefore not require:

Redis
Celery
Docker
Kubernetes
WebSockets
Socket.IO unless actually required
Separate worker servers
RabbitMQ
Elasticsearch
Kubernetes
Microservices

The first version will use:

Node.js
    ↓
Express.js
    ↓
PostgreSQL
    ↓
Flutterwave

Namecheap provides a Setup Node.js App feature where the Node version, application root, application URL, startup file and environment variables can be configured through cPanel.

4. HIGH-LEVEL ARCHITECTURE
                    ┌─────────────────────────┐
                    │    LEAMJOBS FRONTEND    │
                    │       Vercel            │
                    └────────────┬────────────┘
                                 │
                                 │ HTTPS / REST API
                                 ▼
                    ┌─────────────────────────┐
                    │     NODE.JS BACKEND     │
                    │       Express.js        │
                    │      Namecheap          │
                    └────────────┬────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
                ▼                ▼                ▼
       ┌────────────────┐ ┌──────────────┐ ┌──────────────┐
       │  PostgreSQL    │ │ Flutterwave  │ │ Email System │
       │    10.23       │ │   Payments   │ │              │
       └────────────────┘ └──────────────┘ └──────────────┘
5. NODE.JS PROJECT STRUCTURE

Instead of Django's apps/, we will use modular Node.js components.

Recommended structure:

leamjobs-backend/
│
├── package.json
├── package-lock.json
├── server.js
├── .env
├── .env.example
├── .gitignore
├── README.md
│
├── src/
│   │
│   ├── app.js
│   │
│   ├── config/
│   │   ├── database.js
│   │   ├── environment.js
│   │   └── security.js
│   │
│   ├── routes/
│   │   └── index.js
│   │
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── roles.js
│   │   ├── errorHandler.js
│   │   ├── rateLimiter.js
│   │   ├── validation.js
│   │   └── upload.js
│   │
│   ├── modules/
│   │   │
│   │   ├── accounts/
│   │   │   ├── controller.js
│   │   │   ├── service.js
│   │   │   ├── repository.js
│   │   │   ├── routes.js
│   │   │   ├── validation.js
│   │   │   └── tests/
│   │   │
│   │   ├── employers/
│   │   │   ├── controller.js
│   │   │   ├── service.js
│   │   │   ├── repository.js
│   │   │   ├── routes.js
│   │   │   ├── validation.js
│   │   │   └── tests/
│   │   │
│   │   ├── jobs/
│   │   │   ├── controller.js
│   │   │   ├── service.js
│   │   │   ├── repository.js
│   │   │   ├── routes.js
│   │   │   ├── validation.js
│   │   │   ├── filters.js
│   │   │   └── tests/
│   │   │
│   │   ├── applications/
│   │   │   ├── controller.js
│   │   │   ├── service.js
│   │   │   ├── repository.js
│   │   │   ├── routes.js
│   │   │   ├── validation.js
│   │   │   └── tests/
│   │   │
│   │   ├── subscriptions/
│   │   │   ├── controller.js
│   │   │   ├── service.js
│   │   │   ├── repository.js
│   │   │   ├── routes.js
│   │   │   └── tests/
│   │   │
│   │   ├── payments/
│   │   │   ├── controller.js
│   │   │   ├── service.js
│   │   │   ├── repository.js
│   │   │   ├── flutterwave.js
│   │   │   ├── webhook.js
│   │   │   ├── validation.js
│   │   │   ├── routes.js
│   │   │   └── tests/
│   │   │
│   │   ├── notifications/
│   │   │   ├── service.js
│   │   │   ├── email.js
│   │   │   └── tests/
│   │   │
│   │   ├── admin/
│   │   │   ├── controller.js
│   │   │   ├── service.js
│   │   │   ├── routes.js
│   │   │   ├── permissions.js
│   │   │   └── tests/
│   │   │
│   │   └── audit/
│   │       ├── service.js
│   │       ├── repository.js
│   │       └── tests/
│   │
│   ├── database/
│   │   ├── migrations/
│   │   └── seeds/
│   │
│   ├── utils/
│   │   ├── jwt.js
│   │   ├── password.js
│   │   ├── uuid.js
│   │   ├── logger.js
│   │   └── response.js
│   │
│   └── cron/
│       ├── maintenance.js
│       ├── jobs.js
│       └── subscriptions.js
│
├── uploads/
│
└── logs/
Why this structure?

We separate:

Routes
   ↓
Controllers
   ↓
Services
   ↓
Repositories
   ↓
Database

This keeps business logic out of route handlers.

6. TECHNOLOGY STACK

The initial package set should be approximately:

express
pg
dotenv
jsonwebtoken
bcrypt
cors
helmet
express-rate-limit
express-validator
uuid
axios
nodemailer

For development/testing:

nodemon
jest
supertest

We will not install everything blindly. Each package will have a purpose.

7. DATABASE ARCHITECTURE

PostgreSQL 10.23 remains the database.

Node.js will communicate with PostgreSQL through the PostgreSQL Node driver.

Express
   ↓
Service
   ↓
Repository
   ↓
pg
   ↓
PostgreSQL

We can use PostgreSQL's connection pool:

Node.js
   │
   ├── Connection 1
   ├── Connection 2
   ├── Connection 3
   └── Connection N
             ↓
        PostgreSQL

The pool size must be appropriate for shared hosting rather than excessively large.

8. USER MODEL

Users will continue to use UUIDs.

Conceptually:

users

id UUID PRIMARY KEY
email
password_hash
first_name
last_name
phone
role
is_active
is_verified
created_at
updated_at
last_login

Roles:

SEEKER
EMPLOYER
ADMIN

UUID remains a privacy/security improvement, but authorization is still required.

9. AUTHENTICATION

Registration:

POST /api/v1/auth/register
          ↓
Validate request
          ↓
Check email
          ↓
Hash password
          ↓
Generate UUID
          ↓
Create user
          ↓
Send verification email

Login:

POST /api/v1/auth/login
          ↓
Validate credentials
          ↓
Generate access token
          ↓
Generate refresh token
          ↓
Return authentication response

JWT:

Access Token
    ↓
Short lifetime

Refresh Token
    ↓
Longer lifetime

Refresh token rotation/revocation will be implemented.

10. PASSWORD SECURITY

Passwords will never be stored directly.

Instead:

User password
      ↓
bcrypt
      ↓
password_hash
      ↓
PostgreSQL

Never:

password = "mypassword123"
11. EMPLOYERS

Employer module:

employers

Responsibilities:

Employer profile
Company profile
Company information
Company logo
Verification
Employer dashboard

Conceptually:

employer_profiles

id
user_id
company_name
company_email
company_phone
company_description
company_website
company_address
company_logo
verification_status
created_at
updated_at
12. JOBS

Responsibilities:

Create jobs
Edit jobs
Delete jobs
Categories
Locations
Searching
Filtering
Expiration
Approval

Statuses:

PENDING
APPROVED
REJECTED
SUSPENDED
EXPIRED
13. JOB APPROVAL

Employer:

POST /api/v1/jobs
        ↓
Validate
        ↓
Create job
        ↓
PENDING

Admin:

Review
  ↓
APPROVE / REJECT

Only:

APPROVED

jobs can appear publicly.

14. PUBLIC JOB QUERY

The backend must enforce:

status = APPROVED
AND
is_active = TRUE
AND
expires_at > NOW()

The frontend must not be responsible for hiding pending jobs.

15. DATABASE INDEXING

Important indexes:

jobs.status
jobs.employer_id
jobs.category_id
jobs.location_id
jobs.created_at
jobs.expires_at

Potential composite indexes:

(status, created_at)

(status, category_id, created_at)

(status, location_id, created_at)

We will only create indexes justified by actual queries.

16. PERFORMANCE / BIG-O

The same principles remain.

Without useful indexes:

O(n)

With appropriate database indexes, many lookups can approach:

O(log n)

depending on PostgreSQL's execution plan and data distribution.

We will focus on:

Indexing
Pagination
Efficient SQL
Query optimization
Connection pooling
Avoiding N+1 queries
Selecting only required columns
Database constraints
17. AVOIDING N+1 QUERIES

Instead of:

Get 100 jobs

Then:
query employer
query employer
query employer
...

we will use efficient SQL joins or carefully designed queries.

Example:

jobs
JOIN employers
JOIN users

The goal is to avoid unnecessary database round trips.

18. PAGINATION

Never return thousands of jobs in one response.

Example:

GET /api/v1/jobs?page=1&limit=20

Later:

Cursor pagination

can be introduced when required.

19. APPLICATIONS

Application statuses:

SUBMITTED
UNDER_REVIEW
SHORTLISTED
INTERVIEW
REJECTED
HIRED
WITHDRAWN

Relationship:

SEEKER
   ↓
APPLICATION
   ↓
JOB
   ↓
EMPLOYER
20. APPLICATION SECURITY

A seeker can:

Create their own application
View their own applications
Withdraw their own applications

An employer can:

View applications for their own jobs
Update statuses for their own jobs

An employer cannot access another employer's applications.

21. DUPLICATE APPLICATION PROTECTION

Database-level protection:

UNIQUE(seeker_id, job_id)

This provides protection even if two requests arrive simultaneously.

This is particularly important because application-level checks alone are not enough under concurrency.

22. SUBSCRIPTIONS

Plans:

FREE
BASIC
PREMIUM
PRO

Statuses:

PENDING
ACTIVE
EXPIRED
CANCELLED
FAILED
23. FLUTTERWAVE

Flow:

User
 ↓
Select plan
 ↓
Node.js
 ↓
Create payment
 ↓
Flutterwave
 ↓
User pays
 ↓
Flutterwave
 ↓
Webhook / verification
 ↓
Node.js
 ↓
Verify transaction
 ↓
Check amount
 ↓
Check currency
 ↓
Check reference
 ↓
Save payment
 ↓
Activate subscription

The frontend's claim that a payment succeeded will never be enough.

24. PAYMENT IDEMPOTENCY

This remains one of the most important parts of the architecture.

Example:

flutterwave_transaction_id UNIQUE

If Flutterwave sends the same webhook twice:

Webhook 1
   ↓
Process

Webhook 2
   ↓
Transaction already exists
   ↓
Do nothing

No duplicate subscription.

No duplicate payment.

No duplicate activation.

25. WEBHOOK SECURITY

Webhook requests will be:

Validated
Authenticated according to Flutterwave's current webhook mechanism
Server-side verified
Checked against the transaction reference
Checked against expected amount
Checked against expected currency
Made idempotent

The Flutterwave secret key stays on the backend.

26. ENVIRONMENT VARIABLES

Node.js will use .env.

Example:

NODE_ENV=production

PORT=3000

JWT_SECRET_KEY=...

JWT_REFRESH_SECRET_KEY=...

DATABASE_NAME=leamsyyj_leamjobs
DATABASE_USER=leamsyyj_leamjobs_api
DATABASE_PASSWORD=...
DATABASE_HOST=127.0.0.200
DATABASE_PORT=5432

FLUTTERWAVE_PUBLIC_KEY=...
FLUTTERWAVE_SECRET_KEY=...
FLUTTERWAVE_ENCRYPTION_KEY=...

EMAIL_HOST=...
EMAIL_PORT=...
EMAIL_USER=...
EMAIL_PASSWORD=...

CORS_ALLOWED_ORIGINS=https://leamjobs-alpha.vercel.app

.env must never be committed.

27. SECURITY

Express production security will use appropriate middleware such as:

Helmet
CORS
Rate limiting
Input validation
JWT authentication
Authorization middleware
Secure cookies where applicable
HTTPS

We will not blindly copy Django security settings such as:

SECURE_SSL_REDIRECT
CSRF_COOKIE_SECURE

because those are Django-specific.

The security principles remain, but the implementation changes to Node/Express.

28. CORS

Only trusted frontend domains will be allowed.

For example:

https://leamjobs-alpha.vercel.app

We will not use:

origin: "*"

for protected production APIs.

29. ROLE-BASED AUTHORIZATION

Authentication:

Who are you?

Authorization:

What are you allowed to do?

Roles:

SEEKER
EMPLOYER
ADMIN

Example:

POST /api/v1/jobs

requires:

EMPLOYER

Admin endpoints require:

ADMIN
30. OBJECT-LEVEL AUTHORIZATION

Example:

Employer A owns:

Job A

Employer B owns:

Job B

Employer A:

Can edit Job A
Cannot edit Job B

The backend verifies ownership before modifying resources.

31. RATE LIMITING

Rate limiting will apply especially to:

/login
/register
/password-reset
/payment
/payment/verify
/applications

We will configure limits appropriate to shared hosting.

32. INPUT VALIDATION

Validate:

Email
Password
Phone
Job title
Salary
Location
Job description
Application data
Subscription plan
Payment references

Never trust frontend validation.

33. SQL INJECTION

Use parameterized queries.

Good:

SELECT *
FROM jobs
WHERE title ILIKE $1

with:

[$search]

Never:

"SELECT * FROM jobs WHERE title = '" + userInput + "'"
34. XSS

User-generated content remains untrusted.

Potentially dangerous content:

Job descriptions
Company descriptions
Profiles

If rich HTML is eventually supported, sanitize it before storing/rendering.

35. FILE UPLOADS

For:

CVs
Profile pictures
Company logos

validate:

Size
MIME type
Extension
Filename
Content

Uploaded files must not become executable server-side files.

Later we can move uploads to Cloudinary/S3/R2.

36. EMAIL

Node.js will handle:

Verification emails
Password resets
Application notifications
Subscription confirmations
Payment confirmations
Admin notifications

Possible package:

nodemailer

SMTP credentials remain in environment variables.

37. NOTIFICATIONS

Initial production:

Node.js
   ↓
Email service

We don't need Redis/Celery-equivalent infrastructure initially.

Later:

Node.js
   ↓
Redis
   ↓
BullMQ
   ↓
Worker

can be introduced if notification volume becomes large.

38. CRON

Namecheap Cron can trigger Node.js maintenance scripts.

Possible tasks:

Job expiration
Subscription expiration
Payment reconciliation
Cleanup
Notifications

We can have one maintenance command perform several operations.

For example:

node src/cron/maintenance.js

running hourly.

39. JOB EXPIRATION
Cron
 ↓
Find expired jobs
 ↓
expires_at < NOW()
 ↓
status = EXPIRED

Expired jobs are excluded from public API results.

40. SUBSCRIPTION EXPIRATION
Cron
 ↓
Find ACTIVE subscriptions
 ↓
expires_at < NOW()
 ↓
status = EXPIRED
41. AUDIT LOGGING

Record:

Registration
Login
Password change
Job creation
Job approval
Job rejection
Job suspension
Application status changes
Payment verification
Subscription activation
Admin actions

Conceptually:

audit_logs

id
user_id
action
resource_type
resource_id
ip_address
user_agent
created_at

Never store passwords or secret keys.

42. ADMIN

Admin functionality:

Users
Employers
Jobs
Applications
Subscriptions
Payments
Reports
Audit Logs

High-risk operations must be logged.

43. DATABASE CONSTRAINTS

Use PostgreSQL constraints.

Examples:

UNIQUE email

UNIQUE flutterwave_transaction_id

FOREIGN KEY user_id

FOREIGN KEY employer_id

FOREIGN KEY job_id

UNIQUE(seeker_id, job_id)

Database constraints provide another layer of protection.

44. DATABASE TRANSACTIONS

Node.js will use PostgreSQL transactions.

Example payment:

BEGIN
   ↓
Create payment
   ↓
Activate subscription
   ↓
Create audit log
   ↓
COMMIT

If something fails:

ROLLBACK

This is extremely important for financial operations.

45. API VERSIONING

All APIs will start with:

/api/v1/

Example:

/api/v1/auth/login
/api/v1/jobs
/api/v1/applications
/api/v1/payments

Future:

/api/v2/
46. API STRUCTURE
/api/v1/

auth/
    register
    login
    logout
    refresh
    verify-email
    password-reset

users/
    profile
    change-password

employers/
    profile
    company

jobs/
    /
    categories
    locations
    my-jobs

applications/
    /
    my-applications
    job-applications
    status

subscriptions/
    plans
    current
    history

payments/
    initialize
    verify
    webhook

notifications/
    /

admin/
    users
    employers
    jobs
    applications
    payments
    subscriptions
    audit
47. CACHING

Because Redis is unavailable:

Phase 1

Focus on:

PostgreSQL indexes
Efficient queries
Pagination
HTTP caching where appropriate
Connection pooling
Phase 2

After VPS/cloud migration:

Redis

can be introduced.

48. SCALABILITY
Phase 1
Vercel
   ↓
Node.js / Express
   ↓
PostgreSQL
   ↓
Flutterwave

Supporting:

Cron
Email
HTTPS
Logging
49. FUTURE CLOUD ARCHITECTURE

Eventually:

                Cloudflare
                    │
                    ▼
              Load Balancer
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
      Node Server 1       Node Server 2
          │                   │
          └─────────┬─────────┘
                    ▼
                  Redis
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
      Background           Cache
       Workers
                    │
                    ▼
               PostgreSQL

For Node.js background processing, a future option could be BullMQ + Redis.

50. DATABASE SCALABILITY

Initial:

PostgreSQL

Later:

PostgreSQL Primary
       │
       ├── Read Replica 1
       └── Read Replica 2

Only when actual traffic requires it.

51. SEARCH

Initially:

PostgreSQL

Use:

Indexes
Filtering
Pagination
PostgreSQL full-text search where appropriate

Later:

OpenSearch

or:

Elasticsearch

if search requirements justify it.

52. MONITORING

Monitor:

API response time
Error rates
CPU
RAM
Database performance
Failed logins
Failed payments
Webhook failures
5xx responses
Database connection failures

Later:

Sentry
Cloudflare
Uptime monitoring

can be introduced.

53. BACKUPS

Maintain:

Daily PostgreSQL backups
+
Uploaded file backups
+
Configuration backups

Backups should periodically be tested by restoring them.

54. DISASTER RECOVERY

If Namecheap fails:

Provision new server
       ↓
Install Node.js
       ↓
Deploy application
       ↓
Configure PostgreSQL
       ↓
Restore database
       ↓
Restore files
       ↓
Configure environment variables
       ↓
Configure domain
       ↓
Configure SSL
       ↓
Test API
       ↓
Test Flutterwave
       ↓
Go live

The architecture should make this migration straightforward.

55. ERROR HANDLING

Every API should return a consistent structure.

Success:

{
  "success": true,
  "message": "Job retrieved successfully.",
  "data": {}
}

Error:

{
  "success": false,
  "message": "You do not have permission to perform this action.",
  "errors": {}
}

Production responses must not expose:

Stack traces
Database errors
Passwords
API keys
Internal paths
56. TESTING

Tests should cover:

Authentication
Registration
Login
JWT
Refresh
Password reset
Email verification
Authorization
Seeker permissions
Employer permissions
Admin permissions
Object ownership
Jobs
Creation
Editing
Approval
Rejection
Search
Filtering
Expiration
Applications
Creation
Duplicate protection
Withdrawal
Employer access
Payments
Initialization
Verification
Webhooks
Duplicate webhooks
Idempotency
Failed payment
Security
Rate limiting
Input validation
SQL injection
Authorization bypass
File uploads
57. PAYMENT TEST
User starts payment
        ↓
Payment fails
        ↓
Subscription remains inactive

Successful:

Payment succeeds
        ↓
Backend verifies
        ↓
Payment saved
        ↓
Subscription activated

Duplicate webhook:

Same transaction
        ↓
Existing transaction found
        ↓
No second activation
58. DEVELOPMENT ENVIRONMENT

Local:

Node.js
Express.js
PostgreSQL

Optional:

Redis
BullMQ

but not required for Phase 1.

59. DEPENDENCIES

Initial:

express
pg
dotenv
jsonwebtoken
bcrypt
cors
helmet
express-rate-limit
express-validator
uuid
axios
nodemailer

Development:

nodemon
jest
supertest

We will keep dependencies minimal.

60. DEVELOPMENT PRINCIPLES

The backend should follow:

DRY
SOLID
Separation of concerns
Service layer
Repository layer
Input validation
Database constraints
Transactions
Automated tests
Clear API documentation
61. SERVICE LAYER

Complex logic should not live entirely inside controllers.

For example:

payments/

controller.js
    ↓
service.js
    ↓
flutterwave.js
    ↓
repository.js
    ↓
PostgreSQL

Controller:

Handles HTTP.

Service:

Handles business logic.

Flutterwave module:

Handles Flutterwave communication.

Repository:

Handles database operations.

This is one of the most important architectural changes from the original Django design.

62. DATA OWNERSHIP

Every protected resource has an owner.

Job
 ↓
Employer
 ↓
User
Application
 ↓
Seeker
 ↓
User
Payment
 ↓
User
Subscription
 ↓
User

Authorization follows these relationships.

63. CORE DATABASE RELATIONSHIPS
User
 │
 ├── Seeker Profile
 │
 ├── Employer Profile
 │
 ├── Subscription
 │
 ├── Payment
 │
 └── Applications
          │
          ▼
         Job
          │
          ▼
       Employer

Job:

Job
 │
 ├── Category
 ├── Location
 └── Applications
64. DATA INTEGRITY

Rules:

One email = one account

One Flutterwave transaction = one payment

One seeker + one job = one application

One employer owns only its jobs

Only admins approve jobs

Only approved jobs are public

Expired jobs are hidden

Expired subscriptions lose paid access
65. DEPLOYMENT ARCHITECTURE
Local
Developer
   ↓
Git
   ↓
GitHub
Production
GitHub
   ↓
Namecheap
   ↓
cPanel Setup Node.js App
   ↓
Node.js
   ↓
Express
   ↓
PostgreSQL 10.23

Namecheap's current cPanel Node.js system lets you specify the application root, application URL, startup .js file, environment variables, and run npm install.

66. DOMAIN STRUCTURE

Recommended:

leamjobs.com

Frontend:

https://leamjobs.com

Backend:

https://api.leamjobs.com

Optional:

https://admin.leamjobs.com
67. ENVIRONMENT VARIABLES

Production:

NODE_ENV

PORT

DATABASE_NAME
DATABASE_USER
DATABASE_PASSWORD
DATABASE_HOST
DATABASE_PORT

JWT_SECRET_KEY
JWT_REFRESH_SECRET_KEY

FLUTTERWAVE_PUBLIC_KEY
FLUTTERWAVE_SECRET_KEY
FLUTTERWAVE_ENCRYPTION_KEY

EMAIL_HOST
EMAIL_PORT
EMAIL_USER
EMAIL_PASSWORD

CORS_ALLOWED_ORIGINS

Never commit production credentials to GitHub.

68. GIT SECURITY

.gitignore:

.env
node_modules/
logs/
uploads/
*.log

Never commit:

Database passwords
JWT secrets
Flutterwave secret keys
SMTP passwords
API keys
69. DEVELOPMENT ORDER

This is the order I recommend we actually follow.

PHASE 1 — FOUNDATION
Node.js
↓
Express
↓
Project structure
↓
Environment variables
↓
PostgreSQL connection
↓
Health check
↓
Error handling
↓
Security middleware
PHASE 2 — AUTHENTICATION
Users
↓
UUID
↓
Registration
↓
Password hashing
↓
Login
↓
JWT
↓
Refresh tokens
↓
Roles
↓
Permissions
PHASE 3 — EMPLOYERS + JOBS
Employer profiles
↓
Company profiles
↓
Job model
↓
Job creation
↓
Job editing
↓
Job deletion
↓
Job approval
↓
Public job API
↓
Search
↓
Filtering
↓
Pagination
PHASE 4 — APPLICATIONS
Applications
↓
Ownership
↓
Duplicate protection
↓
Application tracking
↓
Employer management
PHASE 5 — PAYMENTS
Subscription plans
↓
Flutterwave
↓
Payment initialization
↓
Verification
↓
Webhook
↓
Idempotency
↓
Subscription activation
PHASE 6 — NOTIFICATIONS
Email verification
↓
Password reset
↓
Application notifications
↓
Payment notifications
↓
Subscription notifications
PHASE 7 — ADMIN
User management
↓
Employer management
↓
Job moderation
↓
Applications
↓
Payments
↓
Subscriptions
↓
Audit logs
PHASE 8 — SECURITY
Rate limiting
↓
Input validation
↓
Authorization testing
↓
File security
↓
Security headers
↓
Payment security
↓
Webhook security
PHASE 9 — PERFORMANCE
Database indexes
↓
Query optimization
↓
Connection pooling
↓
Pagination
↓
N+1 prevention
↓
Load testing
PHASE 10 — DEPLOYMENT
GitHub
↓
Namecheap
↓
Setup Node.js App
↓
Environment variables
↓
npm install
↓
PostgreSQL
↓
Domain
↓
SSL
↓
API testing
↓
Flutterwave webhook
↓
Production
70. LONG-TERM SCALABILITY
NOW
Namecheap
+
Node.js
+
Express
+
PostgreSQL
+
Cron
+
Flutterwave

↓

OPTIMIZATION
Indexes
+
Query optimization
+
Pagination
+
Connection pooling
+
HTTP caching
+
Monitoring

↓

VPS/CLOUD
Node.js servers
+
Redis
+
BullMQ
+
Object storage
+
CDN
+
Load balancer

↓

LARGE SCALE
Multiple Node.js instances
+
Redis
+
Background workers
+
PostgreSQL replicas
+
Dedicated search
+
Monitoring
71. FINAL NODE.JS STACK

So the final architecture becomes:

Component	Technology
Frontend	React / existing Vercel frontend
Backend	Node.js
Framework	Express.js
Database	PostgreSQL 10.23
Database driver	pg
Authentication	JWT
User IDs	UUID
Passwords	bcrypt
Payments	Flutterwave
Email	Nodemailer/SMTP
Validation	express-validator
Security headers	Helmet
CORS	cors
Rate limiting	express-rate-limit
Scheduled tasks	Namecheap Cron
Hosting	Namecheap Stellar Business
Frontend hosting	Vercel
Cache Phase 1	PostgreSQL/HTTP optimization
Cache Phase 2	Redis
Background jobs Phase 2	BullMQ + Redis
File storage Phase 1	Controlled server storage
File storage later	Cloudinary/S3/R2
API	REST
API version	/api/v1/