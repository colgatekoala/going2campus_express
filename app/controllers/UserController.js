var express = require('express');
var User = require('../models/user');
var Trip = require('../models/trip');
var config = require('../config/config.js');
var jwt = require('jsonwebtoken');
var bcrypt = require('bcrypt-nodejs');
var verifyToken = require('../auth/VerifyToken.js');
var Notification = require('../models/notification');

var router = express.Router();

router.use(verifyToken);

router.get('/', function (req, res) {
    User.find({}, function (err, users) {

        if (err) {
            //Log DB errors.
            console.log(err);
            return res.status(503).json(err);
        }
        res.json(users);

    });
});

router.get('/me', function (req, res) {

    User.findById(req.token_user_id, function (err, user) {

        if (err) {
            //Log DB errors.
            console.log(err);
            return res.status(500).json(err);
        }

        if (!user) return res.status(404).json({
            message: "No user found"
        });

        res.status(200).send(user);
    });

});

router.delete('/:id_user', function (req, res) {


    if (!req.token_admin && (req.params.id_user != req.token_user_id)) {
        return res.status(403).json({
            message: "Unauthorized request"
        });
    }

    User.findById(req.params.id_user, function (err, user) {

        if (err) {
            //Log DB errors.
            console.log(err);
            return res.status(503).json(err);
        }

        if (!user) {
            return res.status(404).json({
                message: "User not found."
            });
        }

        user.remove(function (err, user) {

            if (err) {
                //Log DB errors.
                console.log(err);
                return res.status(503).json(err);
            }

            Trip.updateMany({

                driver: req.params.id_user,
                status: 'LISTED'
            }, {
                status: 'CANCELED'

            }, function (err, trips) {

                if (err) {
                    //Log DB errors.
                    console.log(err);
                    return res.status(503).json(err);
                }

            });

            Trip.updateMany({

                passengers: req.params.id_user,
                status: 'LISTED'
            },
                {
                    '$pull': { passengers: req.params.id_user }

            }, function (err, trips) {

                if (err) {
                    //Log DB errors.
                    console.log(err);
                    return res.status(503).json(err);
                }

            });


            return res.status(200).json({
                message: "User deleted successfully."
            });
        });


    });

});

router.get('/:id_user/trips/driver', function (req, res) {

    User.findById(req.params.id_user, function (err, user) {
        if (err) {
            //Log DB errors.
            console.log(err);
            return res.status(503).json(err);
        }

        if (!user) return res.status(404).json({
            message: "User not found."
        });
    });


    Trip.find({
        'driver': req.params.id_user
    }).populate("driver").exec(function (err, trips) {

        if (err){
            //Log DB errors.
            console.log(err);
            return res.status(503).json(err);
        }
        if (trips.length <= 0) return res.status(404).json({
            message: "Trips not found."
        });

        res.status(200).json(trips);

    });

});

router.get('/:id_user/past_trips', function (req, res) {

    User.findById(req.params.id_user, function (err, user) {
        if (err) {
            //Log DB errors.
            console.log(err);
            return res.status(503).json(err);
        }

        if (!user) return res.status(404).json({
            message: "User not found."
        });
    });

    Trip.find({ $or: [{ 'driver': req.params.id_user }, { 'passengers': req.params.id_user }] })
        .where('tripDate').lt(new Date())
        .sort({
            'tripDate': 'asc'
        })
        .populate("driver")
        .populate("passengers")
        .populate("pendingPassengers")
        .exec(function (err, trips) {
            if (err) {
                //Log DB errors.
                console.log(err);
                return res.status(503).json(err);
            }

            res.status(200).json(trips);

        });

});

router.get('/:id_user/future_trips', function (req, res) {

    User.findById(req.params.id_user, function (err, user) {
        if (err) {
            //Log DB errors.
            console.log(err);
            return res.status(503).json(err);
        }

        if (!user) return res.status(404).json({
            message: "User not found."
        });
    });

    Trip.find({ $or: [{ 'driver': req.params.id_user }, { 'passengers': req.params.id_user }] })
        .where('tripDate').gt(new Date())
        .sort({
            'tripDate': 'asc'
        })
        .populate("driver")
        .populate("passengers")
        .populate("pendingPassengers")
        .exec(function (err, trips) {

            if (err) {
                //Log DB errors.
                console.log(err);
                return res.status(503).json(err);
            }

            res.status(200).json(trips);

        });

});

router.patch('/:id_user/edit', [verifyToken, User.postMiddleware], function (req, res) {

    if (!req.token_admin && (req.params.id_user != req.token_user_id)) {
        return res.status(403).json({
            message: "Unauthorized request"
        });
    }

    User.findOneAndUpdate({
        _id: req.params.id_user
    }, req.body, {
        new: true
    }, function (err, user) {
        if (err) {
            //Log DB errors.
            console.log(err);
            return res.status(503).json(err);
        }
        res.status(200).json(user);
    });
});

router.patch('/:id_user/change_password', verifyToken, function (req, res) {

    //Can only edit yourself, unless you're an admin
    if ((req.token_user_id != req.params.id_user) && !req.token_admin) {
        return res.status(403).json({
            message: "Forbidden request."
        });
    }

    //Required fields
    if (!req.body.oldPassword || !req.body.newPassword) {
        return res.status(400).json({
            message: "Bad request. Make sure the fields oldPassword and newPassword exist."
        });
    }

    var id;

    if (req.token_admin && (req.token_user_id != req.params.id_user)) {
        //if you're an admin and you want to change someone's password, the ID will be in the URL parameters
        id = req.params.id_user;
    } else {
        //At this point, you can be an admin or not and you just want to edit yourself, so the ID is yours
        id = req.token_user_id;
    }

    //password is not selected by default, specify you want it here!
    User.findById(id).select('+password').exec(function (err, user) {

        if (err) {
            //Log DB errors.
            console.log(err);
            return res.status(503).json(err);
        }

        if (!user) {
            //If you are an admin, this will warn you about a non found user, if you're not, this was already checked in the middleware!
            return res.status(404).json({
                message: "This user was not found."
            });

        }

        //Compare the old password with the hash stored in the database. 
        if (bcrypt.compareSync(req.body.oldPassword, user.password)) {

            //true, confirmed!
            //Hash the new password!
            user.password = bcrypt.hashSync(req.body.newPassword);

        } else {

            //false, returned!
            return res.status(403).json({
                message: "Forbidden. Wrong credentials."
            });

        }

        //At this point everything is OK, let us save this user!
        user.save(function (err) {

            if (err) {
                //Log DB errors.
                console.log(err);
                return res.status(503).json(err);
            }

            //HOORAY!
            return res.status(200).json({
                message: "Password changed successfully"
            });

        });
    });
});

router.patch('/:id_user/block', verifyToken, function (req, res) {

    //check if the request belongs to an admin
    if (!req.token_admin) {

        return res.status(403).json({
            message: "Forbidden, only admins can block users."
        });
    }

    User.findById(req.params.id_user, function (err, user) {

        if (err) {
            //Log DB errors.
            console.log(err);
            return res.status(503).json(err);
        }

        if (!user) {
            //Not found
            return res.status(404).json({
                message: "This user was not found!"
            });
        }

        user.blocked = true;

        Trip.updateMany({

            driver: req.params.id_user,
            status: 'LISTED'
        }, {
            status: 'CANCELED'

        }, function (err, trips) {

            if (err) {
                //Log DB errors.
                console.log(err);
                return res.status(503).json(err);
            }

        });

        Trip.updateMany({

            passengers: req.params.id_user,
            status: 'LISTED'
        }, {
            '$pull': {
                passengers: req.params.id_user
            }

        }, function (err, trips) {

            if (err) {
                //Log DB errors.
                console.log(err);
                return res.status(503).json(err);
            }

        });

        user.save(function (err) {

            if (err) {
                //Log DB errors.
                console.log(err);
                return res.status(503).json(err);
            }

            return res.status(200).json({
                message: "User blocked with success."
            });

    });
});

});

router.get('/me/notifications', verifyToken, function (req, res) {
    
    
    Notification.find()
    .where('toUser').equals(req.token_user_id)
    .where('isRead').equals(false).exec(function (err,notifications) {       
        if (err) {
            //Log DB errors.
            console.log(err);
            return res.status(503).json(err);
        }
        res.status(200).json(notifications);
    });

    Notification.updateMany({toUser: req.token_user_id},{isRead: true})
    .exec(function(err) {
        if (err) {
            //Log DB errors.
            console.log(err);
            return res.status(503).json(err);
        }
    });

});




module.exports = router;