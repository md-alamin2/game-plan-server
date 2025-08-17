const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const serviceToken = process.env.FIREBASE_SERVICE_TOKEN;
const decoded = Buffer.from(serviceToken, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);
const app = express();
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGO_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// firebase middleware
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const DB = client.db("gamePlaneDB");
    const usersCollection = DB.collection("users");
    const courtsCollection = DB.collection("courts");
    const bookingsCollection = DB.collection("bookings");
    const paymentsCollection = DB.collection("payments");
    const couponsCollection = DB.collection("coupons");
    const announcementsCollection = DB.collection("announcements");
    const reviewsCollection = DB.collection("reviews");

    // custom middleware
    // verify token
    const verifyFirebaseToken = async (req, res, next) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      const token = authHeader.split(" ")[1];
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch {
        return res.status(401).send({ message: "unauthorized access" });
      }
    };
    // verify email
    const verifyFirebaseEmail = (req, res, next) => {
      if (req.query.email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // admin verify
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // All apis

    // users apis
    // get all user and member api (admin)
    app.get("/users", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const search = req.query.search;
      const role = req.query.role;
      let query = {};
      if (search) {
        query = {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        };
      }

      if (role === "member") {
        query = { role };
      } else if (role === "admin") {
        query = { role };
      }
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // get user role by email
    app.get(
      "/users/role",
      verifyFirebaseToken,
      verifyFirebaseEmail,
      async (req, res) => {
        const email = req.query.email;
        const query = { email };
        const result = await usersCollection.findOne(query);
        res.send(result);
      }
    );

    // post user data
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        // update last login
        const lastLogin = req.body.last_login;
        const updateLastLogin = await usersCollection.updateOne(query, {
          $set: { last_login: lastLogin },
        });
        return res.status(200).send(updateLastLogin, {
          message: "user already exists",
          inserted: "false",
        });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // user profile update patch api
    app.patch(
      "/users",
      verifyFirebaseToken,
      verifyFirebaseEmail,
      async (req, res) => {
        const user = req.body;
        const email = req.query.email;
        const query = { email };
        const updateUser = await usersCollection.updateOne(query, {
          $set: user,
        });
        res.send(updateUser);
      }
    );

    // PATCH update user role
    app.patch(
      "/anyUser/role",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.query.email;
        const role = req.body.role;

        if (!["admin", "user", "member"].includes(role)) {
          return res.status(400).json({ message: "Invalid role" });
        }

        const result = await usersCollection.updateOne(
          { email },
          { $set: { role } }
        );

        res.send(result);
      }
    );

    // DELETE user by email (admin only)
    app.delete("/users", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).json({ message: "Email is required in query" });
      }

      const userRecord = await admin.auth().getUserByEmail(email);
      const uid = userRecord.uid;

      await admin.auth().deleteUser(uid);

      const result = await usersCollection.deleteOne({ email });

      res.send(result);
    });

    // members api
    // get members all members with search
    app.get("/members", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const search = req.query.search;
      let query = { role: "member" };
      if (search) {
        query = {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
          role: "member",
        };
      }
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // courts apis
    app.get("/courts", async (req, res) => {
      const court = req.query.search;
      let query = {};
      if (court) {
        query = {
          name: { $regex: court, $options: "i" },
        };
      }

      const result = await courtsCollection.find(query).toArray();
      res.send(result);
    });

    // court pagination api
    app.get("/courts/pagination", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6;
      const search = req.query.search || "";

      const skip = (page - 1) * limit;

      const query = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { sportType: { $regex: search, $options: "i" } },
        ],
      };

      const total = await courtsCollection.countDocuments(query);
      const courts = await courtsCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({
        courts,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      });
    });

    // court post api
    app.post("/courts", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const court = req.body;
      const result = await courtsCollection.insertOne(court);
      res.send(result);
    });

    // court put api
    app.put(
      "/courts/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const updatedCourt = req.body;

        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            ...updatedCourt,
          },
        };

        const result = await courtsCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    app.delete(
      "/courts/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        if (id) {
          await bookingsCollection.deleteMany({ courtId: id });
        }
        const query = { _id: new ObjectId(id) };
        const result = await courtsCollection.deleteOne(query);
        res.send(result);
      }
    );

    // bookings apis
    // get single booking for payment
    app.get("/booking/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const result = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // get all pending bookings(admin)
    app.get(
      "/bookings/pending/all",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const search = req.query.search;
        let query = { status: "pending" };
        if (search) {
          query.$or = [
            { courtName: { $regex: search, $options: "i" } },
            { user: { $regex: search, $options: "i" } },
          ];
        }
        const option = { sort: { booking_at: -1 } };
        const result = await bookingsCollection.find(query, option).toArray();
        return res.send(result);
      }
    );

    // Get user's pending bookings
    app.get(
      "/bookings/pending",
      verifyFirebaseToken,
      verifyFirebaseEmail,
      async (req, res) => {
        const user = req.query.email;
        const search = req.query.search;
        const query = {
          user,
          status: { $in: ["pending", "rejected"] },
          $or: [
            { courtName: { $regex: search, $options: "i" } },
            { courtType: { $regex: search, $options: "i" } },
          ],
        };
        const option = { sort: { booking_at: -1 } };
        const result = await bookingsCollection.find(query, option).toArray();
        res.send(result);
      }
    );

    // Get user's approved bookings
    app.get(
      "/bookings/approved",
      verifyFirebaseToken,
      verifyFirebaseEmail,
      async (req, res) => {
        const user = req.query.email;
        const search = req.query.search;
        const query = {
          user,
          status: "approved",
          $or: [
            { courtName: { $regex: search, $options: "i" } },
            { courtType: { $regex: search, $options: "i" } },
          ],
        };
        const result = await bookingsCollection.find(query).toArray();
        res.send(result);
      }
    );

    // get all users confirmed booking with search
    app.get(
      "/bookings/confirmed/all",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const search = req.query.search;
        const query = {
          status: "confirmed",
          $or: [
            { courtName: { $regex: search, $options: "i" } },
            { user: { $regex: search, $options: "i" } },
          ],
        };
        const option = { sort: { booking_at: -1 } };
        const result = await bookingsCollection.find(query, option).toArray();
        res.send(result);
      }
    );

    // get login user confirmed bookings
    app.get(
      "/bookings/confirmed",
      verifyFirebaseToken,
      verifyFirebaseEmail,
      async (req, res) => {
        const user = req.query.email;
        const search = req.query.search;
        const query = {
          user,
          status: "confirmed",
          $or: [
            { courtName: { $regex: search, $options: "i" } },
            { courtType: { $regex: search, $options: "i" } },
          ],
        };
        const option = { sort: { booking_at: -1 } };
        const result = await bookingsCollection.find(query, option).toArray();
        res.send(result);
      }
    );

    // post booking api
    app.post("/bookings", verifyFirebaseToken, async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    // approve or cancel booking patch api
    app.patch(
      "/bookings/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const status = req.body.status;
        const user = req.body.user;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: status,
          },
        };

        if (status === "approved") {
          await usersCollection.updateOne(
            { email: user },
            { $set: { role: "member", member_since: new Date().toISOString() } }
          );
        }
        const result = await bookingsCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    // Cancel booking
    app.delete("/bookings/:id", verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    // cancel booking and make available the booked courts
    app.delete(
      "/manage/booking/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { courtId, slots } = req.body;

        const court = await courtsCollection.findOne({
          _id: new ObjectId(courtId),
        });

        if (court) {
          const availableSlots = court.slots.map((slot) => {
            const isBooked = slots.some(
              (bookedSlot) =>
                bookedSlot.startTime === slot.startTime &&
                bookedSlot.endTime === slot.endTime
            );
            return {
              ...slot,
              available: isBooked ? true : slot.available,
            };
          });
          const updateCourt = await courtsCollection.updateOne(
            { _id: new ObjectId(courtId) },
            { $set: { slots: availableSlots } }
          );
          if (updateCourt.modifiedCount) {
            const query = { _id: new ObjectId(id) };
            const result = await bookingsCollection.deleteOne(query);
            res.send(result);
          }
        }
      }
    );

    // Create payment intent endpoint
    app.post(
      "/create-payment-intent",
      verifyFirebaseToken,
      async (req, res) => {
        const amount = req.body.amount;
        try {
          const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: "usd",
          });
          res.json({ clientSecret: paymentIntent.client_secret });
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      }
    );

    // get user payment
    app.get(
      "/payments",
      verifyFirebaseToken,
      verifyFirebaseEmail,
      async (req, res) => {
        const email = req.query.email;
        const search = req.query.search;
        const query = {
          email,
          $or: [
            { courtName: { $regex: search, $options: "i" } },
            { transactionId: { $regex: search, $options: "i" } },
          ],
        };
        const option = { sort: { paid_at: -1 } };
        const result = await paymentsCollection.find(query, option).toArray();
        res.send(result);
      }
    );

    // save payment and update court, booking, coupon status
    app.post("/payments", verifyFirebaseToken, async (req, res) => {
      const {
        bookingId,
        courtId,
        slots,
        email,
        amount,
        couponCode,
        maxUses,
        discountAmount,
        transactionId,
      } = req.body;

      const court = await courtsCollection.findOne({
        _id: new ObjectId(courtId),
      });

      if (court) {
        const availableSlots = court.slots.map((slot) => {
          const isBooked = slots.some(
            (bookedSlot) =>
              bookedSlot.startTime === slot.startTime &&
              bookedSlot.endTime === slot.endTime
          );
          return {
            ...slot,
            available: isBooked ? false : slot.available,
          };
        });
        await courtsCollection.updateOne(
          { _id: new ObjectId(courtId) },
          { $set: { slots: availableSlots } }
        );
      }

      await couponsCollection.updateOne(
        { code: couponCode },
        { $set: { maxUses } }
      );

      await bookingsCollection.updateOne(
        {
          _id: new ObjectId(bookingId),
        },
        { $set: { status: "confirmed" } }
      );

      const paymentData = {
        courtName: court.name,
        email,
        amount,
        couponCode,
        discountAmount,
        transactionId,
        pay_at_string: new Date().toISOString(),
        pay_at: new Date(),
      };

      const result = await paymentsCollection.insertOne(paymentData);
      res.send(result);
    });

    // coupons api
    // get active coupons
    app.get("/coupons", async (req, res) => {
      const query = {
        active: true,
      };
      const result = await couponsCollection.find(query).toArray();
      res.send(result);
    });

    // get all coupons for admin
    app.get(
      "/coupons/all",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const coupon = req.query.search;
        let query = {};
        if (coupon) {
          query = {
            code: { $regex: coupon, $options: "i" },
          };
        }
        const result = await couponsCollection.find(query).toArray();
        res.send(result);
      }
    );

    // get single coupon when payment
    app.get("/coupon", verifyFirebaseToken, async (req, res) => {
      const couponCode = req.query.code;
      const query = {
        code: couponCode,
        active: true,
      };
      const result = await couponsCollection.findOne(query);
      res.send(result);
    });

    // coupon post api
    app.post("/coupons", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const coupon = req.body;
      const newCoupon = {
        ...coupon,
        expiryDate: new Date(coupon.expiryDate).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const result = await couponsCollection.insertOne(newCoupon);
      res.send(result);
    });

    // coupon patch
    app.patch(
      "/coupons/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const coupon = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            ...coupon,
            expiryDate: new Date(coupon.expiryDate).toISOString(),
            updated_at: new Date().toISOString(),
          },
        };
        const result = await couponsCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    // coupons delete api
    app.delete(
      "/coupons/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await couponsCollection.deleteOne(query);
        res.send(result);
      }
    );

    // announcement apis

    // Get all announcements with search
    app.get("/announcements", verifyFirebaseToken, async (req, res) => {
      const { title } = req.query;
      let query = {};
      if (title) {
        query = {
          title: { $regex: title, $options: "i" }, // Case-insensitive search
        };
      }
      const announcements = await announcementsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(announcements);
    });

    // announcement post api
    app.post(
      "/announcements",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const announcement = req.body;
        const newAnnouncement = {
          ...announcement,
          created_at: new Date().toISOString(),
        };
        const result = await announcementsCollection.insertOne(newAnnouncement);
        res.send(result);
      }
    );

    // announcement post api
    app.patch(
      "/announcements/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const updatedAnnouncement = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            title: updatedAnnouncement.title,
            description: updatedAnnouncement.description,
          },
        };
        const result = await announcementsCollection.updateOne(
          query,
          updatedDoc
        );
        res.send(result);
      }
    );

    // announcement delete api
    app.delete(
      "/announcements/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await announcementsCollection.deleteOne(query);
        res.send(result);
      }
    );

    // admin dashboard api
    app.get(
      "/dashboard/stats",
      verifyFirebaseToken,
      // verifyAdmin,
      async (req, res) => {
        try {
          const { range } = req.query; // 'week', 'month', or 'year'

          // Calculate date ranges based on the selected period
          const currentDate = new Date();
          let startDate = new Date();

          switch (range) {
            case "week":
              startDate.setDate(currentDate.getDate() - 7);
              break;
            case "month":
              startDate.setMonth(currentDate.getMonth() - 1);
              break;
            case "year":
              startDate.setFullYear(currentDate.getFullYear() - 1);
              break;
            default:
              startDate.setDate(currentDate.getDate() - 7); // Default to week
          }

          // 1. Total Members
          const totalMembers = await usersCollection.countDocuments({
            role: "member",
          });

          // 2. Member Growth (compared to previous period)
          const previousPeriodMembers = await usersCollection.countDocuments({
            role: "member",
            member_since: { $lt: startDate.toISOString() },
          });
          const memberGrowth =
            previousPeriodMembers > 0
              ? (
                  ((totalMembers - previousPeriodMembers) /
                    previousPeriodMembers) *
                  100
                ).toFixed(1)
              : 100;

          // 3. Total Bookings (for current period)
          const totalBookings = await bookingsCollection.countDocuments({
            status: "confirmed",
            booking_at: { $gte: startDate.toISOString() },
          });

          // 4. Booking Growth (compared to previous period)
          const previousPeriodBookings =
            await bookingsCollection.countDocuments({
              status: "confirmed",
              booking_at: {
                $lt: startDate.toISOString(),
                $gte: new Date(
                  new Date(startDate).setDate(
                    startDate.getDate() -
                      (range === "week" ? 7 : range === "month" ? 30 : 365)
                  )
                ),
              },
            });
          const bookingGrowth =
            previousPeriodBookings > 0
              ? (
                  ((totalBookings - previousPeriodBookings) /
                    previousPeriodBookings) *
                  100
                ).toFixed(1)
              : 100;

          // 5. Total Revenue (for current period)
          const revenueResult = await paymentsCollection
            .aggregate([
              {
                $match: {
                  pay_at: { $gte: startDate },
                },
              },
              { $group: { _id: null, total: { $sum: "$amount" } } },
            ])
            .toArray();
          const totalRevenue = revenueResult[0]?.total || 0;

          // 6. Revenue Growth (compared to previous period)
          const previousRevenueResult = await paymentsCollection
            .aggregate([
              {
                $match: {
                  pay_at: {
                    $lt: startDate,
                    $gte: new Date(
                      new Date(startDate).setDate(
                        startDate.getDate() -
                          (range === "week" ? 7 : range === "month" ? 30 : 365)
                      )
                    ),
                  },
                },
              },
              { $group: { _id: null, total: { $sum: "$amount" } } },
            ])
            .toArray();
          const previousRevenue = previousRevenueResult[0]?.total || 0;
          const revenueGrowth =
            previousRevenue > 0
              ? (
                  ((totalRevenue - previousRevenue) / previousRevenue) *
                  100
                ).toFixed(1)
              : 100;

          // 7. Top Court by Bookings
          const topCourtResult = await bookingsCollection
            .aggregate([
              {
                $match: {
                  status: "confirmed",
                  booking_at: { $gte: startDate.toISOString() },
                },
              },
              { $group: { _id: "$courtType", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 1 },
            ])
            .toArray();
          const topCourt = topCourtResult[0]?._id || "None";
          const topCourtBookings = topCourtResult[0]?.count || 0;

          // 8. Booking Trends (last 7 days regardless of selected range)
          const bookingTrends = [];
          const trendDays = range === "week" ? 7 : range === "month" ? 30 : 12; // For year, show 12 months
          const trendInterval = range === "year" ? "month" : "day";

          for (let i = trendDays - 1; i >= 0; i--) {
            const date = new Date();
            if (trendInterval === "day") {
              date.setDate(date.getDate() - i);
            } else {
              date.setMonth(date.getMonth() - i);
            }
            date.setHours(0, 0, 0, 0);
            const nextDate = new Date(date);
            trendInterval === "day"
              ? nextDate.setDate(date.getDate() + 1)
              : nextDate.setMonth(date.getMonth() + 1);

            const count = await bookingsCollection.countDocuments({
              status: "confirmed",
              booking_at: {
                $gte: date.toISOString(),
                $lt: nextDate.toISOString(),
              },
            });
            bookingTrends.push(count);
          }

          // 9. Court Popularity
          const courtPopularity = await bookingsCollection
            .aggregate([
              {
                $match: {
                  status: "confirmed",
                  booking_at: { $gte: startDate.toISOString() },
                },
              },
              { $group: { _id: "$courtType", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
            ])
            .toArray();

          // Prepare labels for booking trends based on range
          let trendLabels = [];
          if (range === "week") {
            trendLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
          } else if (range === "month") {
            trendLabels = Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`);
          } else {
            trendLabels = [
              "Jan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Jun",
              "Jul",
              "Aug",
              "Sep",
              "Oct",
              "Nov",
              "Dec",
            ];
          }

          res.json({
            totalMembers: parseInt(totalMembers),
            memberGrowth: parseFloat(memberGrowth),
            totalBookings: parseInt(totalBookings),
            bookingGrowth: parseFloat(bookingGrowth),
            totalRevenue: parseFloat(totalRevenue.toFixed(2)),
            revenueGrowth: parseFloat(revenueGrowth),
            topCourt,
            topCourtBookings: parseInt(topCourtBookings),
            bookingTrends,
            courtPopularity: {
              labels: courtPopularity.map((item) => item._id),
              data: courtPopularity.map((item) => item.count),
            },
            trendLabels, // Added to match your frontend expectation
          });
        } catch (error) {
          console.error("Dashboard stats error:", error);
          res.status(500).json({ message: "Failed to fetch dashboard stats" });
        }
      }
    );

    // member dashboard api
    app.get("/member/dashboard", verifyFirebaseToken, async (req, res) => {
      try {
        const userEmail = req.query.email; // From Firebase token
        const { range } = req.query;

        // Calculate date ranges
        const startDate = new Date();
        if (range === "week") startDate.setDate(startDate.getDate() - 7);
        else if (range === "month")
          startDate.setMonth(startDate.getMonth() - 1);
        else if (range === "year")
          startDate.setFullYear(startDate.getFullYear() - 1);

        // 1. Upcoming bookings
        const upcomingBookings = await bookingsCollection.countDocuments({
          user: userEmail,
          status: "pending",
        });

        // 2. Next booking date
        const nextBooking = await bookingsCollection.findOne(
          {
            user: userEmail,
            status: "approved",
            booking_at: { $gte: new Date().toISOString() },
          },
          {
            sort: { booking_at: 1 },
            projection: { booking_at: 1 },
          }
        );

        // 3. Total bookings
        const totalBookings = await bookingsCollection.countDocuments({
          user: userEmail,
          status: "confirmed",
        });

        // 4. Booking growth
        const previousPeriodBookings = await bookingsCollection.countDocuments({
          user: userEmail,
          status: "confirmed",
          booking_at: {
            $gte: new Date(startDate).toISOString(),
            $lt: new Date(
              new Date(startDate).setDate(
                startDate.getDate() -
                  (range === "week" ? 7 : range === "month" ? 30 : 365)
              )
            ),
          },
        });
        const bookingGrowth =
          previousPeriodBookings > 0
            ? (
                ((totalBookings - previousPeriodBookings) /
                  previousPeriodBookings) *
                100
              ).toFixed(1)
            : 100;

        // 5. Favorite court
        const favoriteCourt = await bookingsCollection
          .aggregate([
            { $match: { user: userEmail, status: "confirmed" } },
            { $group: { _id: "$courtType", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 },
          ])
          .toArray();

        // 6. Activity trend
        const activityLabels = [];
        const bookingActivity = [];
        const periods = range === "year" ? 12 : range === "month" ? 4 : 7;

        for (let i = 0; i < periods; i++) {
          const periodStart = new Date(startDate);
          const periodEnd = new Date(startDate);

          if (range === "year") {
            periodStart.setMonth(startDate.getMonth() + i);
            periodEnd.setMonth(startDate.getMonth() + i + 1);
            activityLabels.push(
              periodStart.toLocaleString("default", { month: "short" })
            );
          } else if (range === "month") {
            periodStart.setDate(startDate.getDate() + i * 7);
            periodEnd.setDate(startDate.getDate() + (i + 1) * 7);
            activityLabels.push(`Week ${i + 1}`);
          } else {
            periodStart.setDate(startDate.getDate() + i);
            periodEnd.setDate(startDate.getDate() + i + 1);
            activityLabels.push(
              periodStart.toLocaleString("default", { weekday: "short" })
            );
          }

          const count = await bookingsCollection.countDocuments({
            user: userEmail,
            status: "confirmed",
            booking_at: {
              $gte: periodStart.toISOString(),
              $lt: periodEnd.toISOString(),
            },
          });

          bookingActivity.push(count);
        }

        // 7. Recent bookings
        const recentBookings = await bookingsCollection
          .find({
            user: userEmail,
            status: "confirmed",
          })
          .sort({ booking_at: -1 })
          .limit(3)
          .toArray();

        // 8. Total spent
        const totalSpentResult = await paymentsCollection
          .aggregate([
            { $match: { email: userEmail } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ])
          .toArray();

        const user = await usersCollection.findOne({ email: userEmail });

        res.json({
          upcomingBookings,
          nextBookingDate: nextBooking?.booking_at
            ? new Date(nextBooking.booking_at).toLocaleDateString()
            : "No upcoming bookings",
          totalBookings,
          bookingGrowth: parseFloat(bookingGrowth),
          favoriteCourt: favoriteCourt[0]?._id || "None",
          favoriteCourtBookings: favoriteCourt[0]?.count || 0,
          activityLabels,
          bookingActivity,
          recentBookings,
          totalSpent: totalSpentResult[0]?.total || 0,
          memberSince: user?.member_since,
        });
      } catch (error) {
        console.error("Member dashboard error:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch member dashboard data" });
      }
    });
    // reviews api
    // get all reviews
    app.get("/reviews", async (req, res) => {
      const result = await reviewsCollection.find().toArray();
      res.send(result);
    });

    // post a review
    app.post("/reviews", verifyFirebaseToken, async (req, res) => {
      const review = req.body;
      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Game Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
