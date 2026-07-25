import { Button } from "@/components/ui/button";
import prisma from "@/lib/prisma";
import stripe from "@/lib/stripe";
import { clerkClient, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const params = await searchParams;

  if (params.session_id) {
    await syncSubscriptionFromCheckoutSession(params.session_id);
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-3 py-6 text-center">
      <h1 className="text-3xl font-bold">Billing Success</h1>
      <p>
        The checkout was successful and your Pro account has been activated.
        Enjoy!
      </p>
      <Button asChild>
        <Link href="/resumes">Go to resumes</Link>
      </Button>
    </main>
  );
}

async function syncSubscriptionFromCheckoutSession(sessionId: string) {
  const user = await currentUser();

  if (!user) {
    return;
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });

  const subscription = session.subscription;

  if (!subscription || typeof subscription === "string") {
    return;
  }

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;

  if (customerId) {
    await (
      await clerkClient()
    ).users.updateUserMetadata(user.id, {
      privateMetadata: {
        stripeCustomerId: customerId,
      },
    });
  }

  const priceId = subscription.items.data[0]?.price.id;

  if (!priceId) {
    return;
  }

  await prisma.userSubscription.upsert({
    where: {
      userId: user.id,
    },
    create: {
      userId: user.id,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId ?? "",
      stripePriceId: priceId,
      stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
      stripeCancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
    update: {
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
      stripeCancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });
}
