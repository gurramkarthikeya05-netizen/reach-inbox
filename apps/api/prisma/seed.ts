import { PrismaClient } from '@prisma/client';
import { config } from '../src/config.js';

const prisma = new PrismaClient();

await prisma.sender.updateMany({
	where: { id: { notIn: config.SMTP_SENDERS_JSON.map((sender) => sender.id) } },
	data: { active: false },
});

for (const sender of config.SMTP_SENDERS_JSON) {
	await prisma.sender.upsert({
		where: { id: sender.id },
		create: {
			id: sender.id,
			name: sender.name,
			email: sender.email,
			maxEmailsPerHour: config.MAX_EMAILS_PER_HOUR_PER_SENDER,
		},
		update: {
			name: sender.name,
			email: sender.email,
			maxEmailsPerHour: config.MAX_EMAILS_PER_HOUR_PER_SENDER,
			active: true,
		},
	});
}

await prisma.$disconnect();
