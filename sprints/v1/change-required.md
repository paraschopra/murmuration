what i want to display on new tabs is a self-contained html/css/js (perhaps in an iframe? but i'm not sure). this self-contained html/css/js would be generated via the following prompt:                                                            

"""
based on given topics that user has been chatting about, create a self-contained html/css/js page that can be shown to the user in an iframe on a new tab to reflect her state of mind. pick one topic or some common theme, don't mix everything. we will later generate more, so user can see various different artifacts on a new tab.

create a minimal ascii or related art, html css based. e.g. Fractal, aquarium, scenery. glitchy, whimsical, awe-inspiring. Black and white only. (White background preferred). Animated. Be creative. Reflect state of user's mind. Pick odd ones, surprise the user. Don't be boring. output only self-contained html, nothing else.
topics: <list of topics that user has been chatting about that we get from chatgpt/claude>
"""

also, to save tokens, we need to get a user configurable number of per day fetches of this html/css/js. Default is 3 fetches. But we should have some randomization in the topics when we fetch. Perhaps only use 3 random topics out of the entire list. This woule ensure each generated visual is maximally different fromt the other.