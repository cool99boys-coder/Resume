import { env } from "@/env";
import prisma from "@/lib/prisma";
import stripe from "@/lib/stripe";
import { clerkClient } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return new Response("Signature is missing", { status: 400 });
    }

    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );

    console.log(`Received event: ${event.type}`, event.data.object);

    switch (event.type) {
      case "checkout.session.completed":
        await handleSessionCompleted(event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionCreatedOrUpdated(event.data.object.id);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
        break;
    }

    return new Response("Event received", { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response("Internal server error", { status: 500 });
  }
}

async function handleSessionCompleted(session: Stripe.Checkout.Session) {
  const userId = await resolveUserIdFromSession(session);

  if (!userId) {
    throw new Error("User ID could not be resolved from the checkout session");
  }

  await (
    await clerkClient()
  ).users.updateUserMetadata(userId, {
    privateMetadata: {
      stripeCustomerId: session.customer as string,
    },
  });

  if (session.subscription) {
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;

    const stripeSubscription =
      await stripe.subscriptions.retrieve(subscriptionId);

    await upsertUserSubscription(stripeSubscription, userId);
  }
}

async function resolveUserIdFromSession(session: Stripe.Checkout.Session) {
  const explicitUserId =
    session.metadata?.userId ?? session.client_reference_id;

  if (explicitUserId) {
    return explicitUserId;
  }

  const email = session.customer_details?.email ?? session.customer_email;

  if (email) {
    const clerk = await clerkClient();
    const users = await clerk.users.getUserList({ limit: 200 });
    const matchingUser = users.data.find((user) =>
      user.emailAddresses.some(
        (emailAddress) => emailAddress.emailAddress === email,
      ),
    );

    if (matchingUser) {
      return matchingUser.id;
    }
  }

  return undefined;
}

async function upsertUserSubscription(
  subscription: Stripe.Subscription,
  userId?: string,
) {
  let resolvedUserId = userId ?? subscription.metadata?.userId;

  if (!resolvedUserId) {
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;

    if (customerId) {
      const clerk = await clerkClient();
      const users = await clerk.users.getUserList({ limit: 200 });
      const matchingUser = users.data.find((user) => {
        const storedCustomerId = user.privateMetadata?.stripeCustomerId;
        return storedCustomerId === customerId;
      });

      if (matchingUser) {
        return upsertUserSubscription(subscription, matchingUser.id);
      }
    }

    const existingSubscription = await prisma.userSubscription.findFirst({
      where: {
        stripeCustomerId: customerId ?? "",
      },
      select: {
        userId: true,
      },
    });

    if (!existingSubscription?.userId) {
      throw new Error("User ID could not be resolved for the subscription");
    }

    resolvedUserId = existingSubscription.userId;
  }

  if (!resolvedUserId) {
    throw new Error("User ID could not be resolved for the subscription");
  }

  const priceId = subscription.items.data[0]?.price.id;

  if (!priceId) {
    throw new Error("No price found on subscription");
  }

  await prisma.userSubscription.upsert({
    where: {
      userId: resolvedUserId,
    },
    create: {
      userId: resolvedUserId,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: subscription.customer as string,
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

async function handleSubscriptionCreatedOrUpdated(subscriptionId: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  if (
    subscription.status === "active" ||
    subscription.status === "trialing" ||
    subscription.status === "past_due"
  ) {
    await upsertUserSubscription(subscription);
  } else {
    await prisma.userSubscription.deleteMany({
      where: {
        stripeCustomerId: subscription.customer as string,
      },
    });
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  await prisma.userSubscription.deleteMany({
    where: {
      stripeCustomerId: subscription.customer as string,
    },
  });
}
