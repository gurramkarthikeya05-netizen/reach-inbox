import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { config } from './config.js';
import { prisma } from './infrastructure.js';

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user ? { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl } : false);
  } catch (error) {
    done(error);
  }
});

passport.use(
  new GoogleStrategy(
    {
      clientID: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      callbackURL: config.GOOGLE_CALLBACK_URL,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(new Error('Google account did not provide an email address'));
        const avatarUrl = profile.photos?.[0]?.value ?? null;
        const user = await prisma.user.upsert({
          where: { googleSubjectId: profile.id },
          create: {
            googleSubjectId: profile.id,
            email: email.toLowerCase(),
            name: profile.displayName,
            avatarUrl,
          },
          update: {
            email: email.toLowerCase(),
            name: profile.displayName,
            avatarUrl,
          },
        });
        done(null, { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl });
      } catch (error) {
        done(error as Error);
      }
    },
  ),
);

export { passport };