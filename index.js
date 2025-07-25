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

    // users apis
    app.get("/users", async (req, res) => {
      const user = req.query.search;
      const role = req.query.role;
      let query = {};
      if (user) {
        query = {
          name: { $regex: user, $options: "i" },
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
    app.get("/users/role", async (req, res) => {
      const email = req.query.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

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

    app.patch("/users", async (req, res) => {
      const user = req.body;
      const email = req.query.email;
      const query = { email };
      const updateUser = await usersCollection.updateOne(query, {
        $set: user,
      });
      res.send(updateUser);
    });

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

    // get members
    app.get("/members", async (req, res) => {
      const user = req.query.search;
      let query = { role: "member" };
      if (user) {
        query = {
          name: { $regex: user, $options: "i" },
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

    // court post api
    app.post("/courts", async (req, res) => {
      const court = req.body;
      const result = await courtsCollection.insertOne(court);
      res.send(result);
    });

    app.put("/courts/:id", async (req, res) => {
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
    });

    app.delete("/courts/:id", async (req, res) => {
      const id = req.params.id;
      if (id) {
        await bookingsCollection.deleteMany({ courtId: id });
      }
      const query = { _id: new ObjectId(id) };
      const result = await courtsCollection.deleteOne(query);
      res.send(result);
    });

    // bookings apis
    app.get("/booking/:id", async (req, res) => {
      const id = req.params.id;
      const result = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // Get user's pending bookings
    app.get("/bookings/pending", async (req, res) => {
      const user = req.query.user;
      const role = req.query.role;
      const search = req.query.search;
      let query;
      if (role === "admin") {
        query = { status: "pending" };
        const result = await bookingsCollection.find(query).toArray();
        return res.send(result);
      }
      query = {
        user,
        status: { $in: ["pending", "rejected"] },
        $or: [
          { courtName: { $regex: search, $options: "i" } },
          { courtType: { $regex: search, $options: "i" } },
        ],
      };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/bookings/approved", async (req, res) => {
      const user = req.query.user;
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
    });

    app.get("/bookings/confirmed", async (req, res) => {
      const user = req.query.user;
      const search = req.query.search;
      let query;
      if (user) {
        query = {
          user,
          status: "confirmed",
          $or: [
            { courtName: { $regex: search, $options: "i" } },
            { courtType: { $regex: search, $options: "i" } },
          ],
        };
      } else {
        query = {
          status: "confirmed",
          $or: [
            { courtName: { $regex: search, $options: "i" } },
            { user: { $regex: search, $options: "i" } },
          ],
        };
      }
      const option = { sort: { booking_at: -1 } };
      const result = await bookingsCollection.find(query, option).toArray();
      res.send(result);
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    app.patch("/bookings/:id", async (req, res) => {
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
    });

    // Cancel booking
    app.delete("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    // cancel booking and make available the booked courts
    app.delete("/manage/booking/:id", async (req, res) => {
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
    });

    // Create payment intent endpoint
    app.post("/create-payment-intent", async (req, res) => {
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
    });

    // get user payment
    app.get("/payments", async (req, res) => {
      const email = req.query.user;
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
    });

    // save payment and update court, booking, coupon status
    app.post("/payments", async (req, res) => {
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
    app.get("/coupons", async (req, res) => {
      const coupon = req.query.search;
      let query = {};
      if (coupon) {
        query = {
          code: { $regex: coupon, $options: "i" },
        };
      }
      const result = await couponsCollection.find(query).toArray();
      res.send(result);
    });

    // get single coupon when payment
    app.get("/coupon", async (req, res) => {
      const couponCode = req.query.code;
      const query = {
        code: couponCode,
        active: true,
      };
      const result = await couponsCollection.findOne(query);
      res.send(result);
    });

    // coupon post api
    app.post("/coupons", async (req, res) => {
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
    app.patch("/coupons/:id", async (req, res) => {
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
    });

    // coupons delete api
    app.delete("/coupons/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await couponsCollection.deleteOne(query);
      res.send(result);
    });

    // announcement apis

    app.get("/announcements", async (req, res) => {
      const result = await announcementsCollection.find().toArray();
      res.send(result);
    });

    // announcement search api
    app.get("/announcements/search", async (req, res) => {
      try {
        const { title } = req.query;
        const announcements = await announcementsCollection
          .find({
            title: { $regex: title, $options: "i" }, // Case-insensitive search
          })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(announcements);
      } catch (err) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // announcement post api
    app.post("/announcements", async (req, res) => {
      const announcement = req.body;
      const newAnnouncement = {
        ...announcement,
        created_at: new Date().toISOString(),
      };
      const result = await announcementsCollection.insertOne(newAnnouncement);
      res.send(result);
    });

    // announcement post api
    app.patch("/announcements/:id", async (req, res) => {
      const id = req.params.id;
      const updatedAnnouncement = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          title: updatedAnnouncement.title,
          description: updatedAnnouncement.description,
        },
      };
      const result = await announcementsCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // announcement delete api
    app.delete("/announcements/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await announcementsCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
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
