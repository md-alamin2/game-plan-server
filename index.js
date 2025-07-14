const express = require('express');
const app = express();
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion } = require('mongodb');



app.use(cors());
app.use(express.json());





// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGO_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const DB = client.db("gamePlaneDB");
    const usersCollection = DB.collection("users");

    // users apis
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        // update last login
        const lastLogin = req.body.last_login;
        const updateLastLogin = await usersCollection.updateOne(
          { email },
          { $set: { last_login: lastLogin } }
        );
        return res.status(200).send(updateLastLogin, {
          message: "user already exists",
          inserted: "false",
        });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    })


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get("/", (req, res) => {
  res.send("Game Server is running");
});

app.listen(port, ()=>{
    console.log(`Server is running on port ${port}`);
})