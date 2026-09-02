const publicUserFields = [
  'id',
  'firstName',
  'lastName',
  'email',
  'phone',
  'role',
  'isActive',
  'isVerified',
  'createdAt',
];

export const toUserResponse = (user) =>
  Object.fromEntries(publicUserFields.map((field) => [field, user[field]]));
